using System;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Threading;

class SpotifyWatcher {
    static void Main(string[] args) {
        Console.OutputEncoding = Encoding.UTF8;

        string overlayPath = "";
        bool autoClose = true;
        int pollIntervalMs = 2500;

        for (int i = 0; i < args.Length; i++) {
            if (args[i] == "-OverlayPath" && i + 1 < args.Length) overlayPath = args[i + 1];
            if (args[i] == "-NoAutoClose") autoClose = false;
            if (args[i] == "-PollMs" && i + 1 < args.Length) int.TryParse(args[i + 1], out pollIntervalMs);
        }

        // If overlay path not explicitly provided, look in same directory as watcher
        if (string.IsNullOrEmpty(overlayPath)) {
            string currentDir = AppDomain.CurrentDomain.BaseDirectory;
            string candidate = Path.Combine(currentDir, "overtone.exe");
            if (File.Exists(candidate)) {
                overlayPath = candidate;
            } else {
                candidate = Path.Combine(currentDir, "neutralino-win_x64.exe");
                if (File.Exists(candidate)) overlayPath = candidate;
            }
        }

        if (string.IsNullOrEmpty(overlayPath) || !File.Exists(overlayPath)) {
            Console.WriteLine("{\"error\":\"Overlay executable not found at: " + overlayPath.Replace("\\", "\\\\") + "\"}");
            return;
        }

        // Ensure single watcher instance via named Mutex
        bool createdNew;
        using (Mutex mutex = new Mutex(true, "Overtone_Watcher_Mutex", out createdNew)) {
            if (!createdNew) {
                Console.WriteLine("{\"status\":\"already_running\"}");
                return;
            }

            Console.WriteLine("{\"status\":\"watcher_started\",\"overlay\":\"" + overlayPath.Replace("\\", "\\\\") + "\"}");

            // Edge-triggered: only react when Spotify starts or stops, so a user who quits
            // Overtone while Spotify is running is not relaunched on the next poll.
            bool spotifyWasRunning = false; // false: if Spotify is already open when the watcher starts (login), launch once
            bool overlayWasStartedByUs = false;
            DateTime lastSeenSpotify = DateTime.MinValue;

            while (true) {
                try {
                    // Debounce: Spotify briefly exits/restarts (updates, crash-restart); only treat it as
                    // stopped after it has been gone for 6s, so a blip never re-triggers a launch.
                    if (IsSpotifyRunning()) lastSeenSpotify = DateTime.UtcNow;
                    bool spotifyRunning = (DateTime.UtcNow - lastSeenSpotify).TotalSeconds < 6;
                    // Once our instance is gone (user quit), a later manual launch is the user's: never auto-close it
                    if (overlayWasStartedByUs && !IsOverlayRunning()) overlayWasStartedByUs = false;

                    if (spotifyRunning && !spotifyWasRunning && !IsOverlayRunning()) {
                        try {
                            ProcessStartInfo psi = new ProcessStartInfo {
                                FileName = overlayPath,
                                WorkingDirectory = Path.GetDirectoryName(overlayPath),
                                UseShellExecute = true
                            };
                            Process.Start(psi);
                            overlayWasStartedByUs = true;
                        } catch {}
                    } else if (!spotifyRunning && spotifyWasRunning) {
                        if (autoClose && overlayWasStartedByUs) CloseOverlay();
                        overlayWasStartedByUs = false;
                    }
                    spotifyWasRunning = spotifyRunning;
                } catch {}

                Thread.Sleep(pollIntervalMs);
            }
        }
    }

    static bool IsSpotifyRunning() {
        Process[] procs = Process.GetProcessesByName("Spotify");
        return procs.Length > 0;
    }

    static bool IsOverlayRunning() {
        string[] names = new string[] { "overtone", "neutralino-win_x64" };
        foreach (string name in names) {
            Process[] procs = Process.GetProcessesByName(name);
            if (procs.Length > 0) return true;
        }
        return false;
    }

    static void CloseOverlay() {
        string[] names = new string[] { "overtone", "neutralino-win_x64" };
        foreach (string name in names) {
            foreach (Process p in Process.GetProcessesByName(name)) {
                try {
                    p.CloseMainWindow();
                    if (!p.WaitForExit(5000)) {
                        p.Kill();
                    }
                } catch {}
            }
        }
    }
}
