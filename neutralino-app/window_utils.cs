using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Windows.Forms;
using Microsoft.Win32;

class WindowUtils {
    [DllImport("user32.dll", EntryPoint = "GetWindowLong")]
    private static extern IntPtr GetWindowLongPtr32(IntPtr hWnd, int nIndex);

    [DllImport("user32.dll", EntryPoint = "GetWindowLongPtr")]
    private static extern IntPtr GetWindowLongPtr64(IntPtr hWnd, int nIndex);

    public static IntPtr GetWindowLongPtr(IntPtr hWnd, int nIndex) {
        if (IntPtr.Size == 8) return GetWindowLongPtr64(hWnd, nIndex);
        return GetWindowLongPtr32(hWnd, nIndex);
    }

    [DllImport("user32.dll", EntryPoint = "SetWindowLong")]
    private static extern IntPtr SetWindowLongPtr32(IntPtr hWnd, int nIndex, IntPtr dwNewLong);

    [DllImport("user32.dll", EntryPoint = "SetWindowLongPtr")]
    private static extern IntPtr SetWindowLongPtr64(IntPtr hWnd, int nIndex, IntPtr dwNewLong);

    public static IntPtr SetWindowLongPtr(IntPtr hWnd, int nIndex, IntPtr dwNewLong) {
        if (IntPtr.Size == 8) return SetWindowLongPtr64(hWnd, nIndex, dwNewLong);
        return SetWindowLongPtr32(hWnd, nIndex, dwNewLong);
    }

    const int GWL_EXSTYLE = -20;
    const int WS_EX_LAYERED = 0x80000;
    const int WS_EX_TRANSPARENT = 0x20;

    static void Main(string[] args) {
        Console.OutputEncoding = Encoding.UTF8;
        string action = "";
        string exePath = "";
        int x = 0, y = 0, width = 600, height = 400;

        for (int i = 0; i < args.Length; i++) {
            if (args[i] == "-Action" && i + 1 < args.Length) action = args[i + 1];
            if (args[i] == "-ExePath" && i + 1 < args.Length) exePath = args[i + 1];
            if (args[i] == "-X" && i + 1 < args.Length) int.TryParse(args[i + 1], out x);
            if (args[i] == "-Y" && i + 1 < args.Length) int.TryParse(args[i + 1], out y);
            if (args[i] == "-Width" && i + 1 < args.Length) int.TryParse(args[i + 1], out width);
            if (args[i] == "-Height" && i + 1 < args.Length) int.TryParse(args[i + 1], out height);
        }

        if (string.IsNullOrEmpty(action)) return;

        if (action == "create-shortcuts") {
            try {
                string baseDir = AppDomain.CurrentDomain.BaseDirectory;
                string targetExe = exePath;
                if (string.IsNullOrEmpty(targetExe) || !File.Exists(targetExe)) {
                    string[] candidates = new string[] {
                        Path.Combine(baseDir, "overtone.exe"),
                        Path.Combine(baseDir, "neutralino-win_x64.exe")
                    };
                    foreach (string c in candidates) {
                        try {
                            if (File.Exists(c)) { targetExe = Path.GetFullPath(c); break; }
                        } catch {}
                    }
                }

                if (string.IsNullOrEmpty(targetExe) || !File.Exists(targetExe)) {
                    Console.WriteLine("{\"error\":\"Target executable not found to create shortcut.\"}");
                    return;
                }

                Type shellType = Type.GetTypeFromProgID("WScript.Shell");
                if (shellType == null) {
                    Console.WriteLine("{\"error\":\"WScript.Shell COM not available\"}");
                    return;
                }
                dynamic shell = Activator.CreateInstance(shellType);

                string desktopPath = Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory);
                string startMenuPath = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.StartMenu), "Programs");

                int createdCount = 0;
                string[] targetFolders = new string[] { desktopPath, startMenuPath };
                foreach (string folder in targetFolders) {
                    if (Directory.Exists(folder)) {
                        try { File.Delete(Path.Combine(folder, "Spotify Lyrics Overlay.lnk")); } catch {} // pre-rename shortcut
                        string shortcutFile = Path.Combine(folder, "Overtone.lnk");
                        dynamic shortcut = shell.CreateShortcut(shortcutFile);
                        shortcut.TargetPath = targetExe;
                        shortcut.WorkingDirectory = Path.GetDirectoryName(targetExe);
                        shortcut.Description = "Overtone - floating synced lyrics for Spotify";

                        string iconLocation = targetExe + ",0";
                        string[] iconCandidates = new string[] {
                            Path.Combine(baseDir, "appIcon.ico"),
                            Path.Combine(Path.GetDirectoryName(targetExe), "appIcon.ico"),
                            Path.Combine(baseDir, "resources\\icons\\appIcon.ico"),
                            Path.Combine(Path.GetDirectoryName(targetExe), "resources\\icons\\appIcon.ico"),
                            Path.Combine(baseDir, "resources\\icons\\appIcon.png"),
                            Path.Combine(Path.GetDirectoryName(targetExe), "resources\\icons\\appIcon.png")
                        };
                        foreach (string ic in iconCandidates) {
                            try {
                                if (File.Exists(ic)) { iconLocation = Path.GetFullPath(ic); break; }
                            } catch {}
                        }
                        shortcut.IconLocation = iconLocation;
                        shortcut.Save();
                        createdCount++;
                    }
                }

                Console.WriteLine("{\"status\":\"success\",\"shortcuts_created\":" + createdCount + ",\"target\":\"" + targetExe.Replace("\\", "\\\\") + "\"}");
            } catch (Exception ex) {
                Console.WriteLine("{\"error\":\"" + ex.Message.Replace("\"", "'") + "\"}");
            }
            return;
        }

        if (action == "enable-spotify-watcher") {
            try {
                string baseDir = AppDomain.CurrentDomain.BaseDirectory;
                string watcherExe = Path.Combine(baseDir, "spotify_watcher.exe");
                string overlayExe = Path.Combine(baseDir, "overtone.exe");
                if (!File.Exists(overlayExe)) {
                    overlayExe = Path.Combine(baseDir, "neutralino-win_x64.exe");
                }

                if (!File.Exists(watcherExe)) {
                    Console.WriteLine("{\"error\":\"spotify_watcher.exe not found at " + watcherExe.Replace("\\", "\\\\") + "\"}");
                    return;
                }

                string runCommand = "\"" + watcherExe + "\" -OverlayPath \"" + overlayExe + "\"";
                using (RegistryKey key = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Run", true)) {
                    if (key != null) {
                        key.SetValue("OvertoneWatcher", runCommand);
                        key.DeleteValue("SpotifyLyricsOverlayWatcher", false); // pre-rename entries
                        key.DeleteValue("SpotifyLyricsOverlay", false);
                    }
                }

                // Check if watcher process is already running, if not start it
                Process[] watcherProcs = Process.GetProcessesByName("spotify_watcher");
                if (watcherProcs.Length == 0) {
                    ProcessStartInfo psi = new ProcessStartInfo {
                        FileName = watcherExe,
                        Arguments = "-OverlayPath \"" + overlayExe + "\"",
                        WorkingDirectory = baseDir,
                        // ShellExecute: detached, no inherited stdout handles; otherwise the caller
                        // (Overtone's execCommand) waits on the pipe until the watcher exits = forever
                        UseShellExecute = true,
                        WindowStyle = ProcessWindowStyle.Hidden
                    };
                    Process.Start(psi);
                }

                Console.WriteLine("{\"status\":\"success\",\"watcher\":true}");
            } catch (Exception ex) {
                Console.WriteLine("{\"error\":\"" + ex.Message.Replace("\"", "'") + "\"}");
            }
            return;
        }

        if (action == "disable-spotify-watcher") {
            try {
                using (RegistryKey key = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Run", true)) {
                    if (key != null) {
                        key.DeleteValue("OvertoneWatcher", false);
                        key.DeleteValue("SpotifyLyricsOverlayWatcher", false);
                    }
                }

                // Stop running watcher processes
                Process[] watcherProcs = Process.GetProcessesByName("spotify_watcher");
                foreach (var p in watcherProcs) {
                    try { p.Kill(); } catch {}
                }

                Console.WriteLine("{\"status\":\"success\",\"watcher\":false}");
            } catch (Exception ex) {
                Console.WriteLine("{\"error\":\"" + ex.Message.Replace("\"", "'") + "\"}");
            }
            return;
        }

        if (action == "check-spotify-watcher") {
            try {
                bool exists = false;
                using (RegistryKey key = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Run", false)) {
                    if (key != null) {
                        object val = key.GetValue("OvertoneWatcher");
                        if (val != null) exists = true;
                    }
                }
                Console.WriteLine("{\"watcher\":" + (exists ? "true" : "false") + "}");
            } catch (Exception ex) {
                Console.WriteLine("{\"error\":\"" + ex.Message.Replace("\"", "'") + "\"}");
            }
            return;
        }

        if (action == "validate-bounds") {
            try {
                Rectangle rect = new Rectangle(x, y, width, height);
                bool isVisible = false;
                foreach (Screen s in Screen.AllScreens) {
                    if (s.Bounds.IntersectsWith(rect)) {
                        isVisible = true;
                        break;
                    }
                }
                Console.WriteLine("{\"valid\":" + (isVisible ? "true" : "false") + "}");
            } catch (Exception ex) {
                Console.WriteLine("{\"error\":\"" + ex.Message.Replace("\"", "'") + "\"}");
            }
            return;
        }

        // Clickthrough actions require window handle
        IntPtr hwnd = IntPtr.Zero;
        string[] processNames = new string[] { "overtone", "neutralino-win_x64", "neutralino" };
        foreach (string name in processNames) {
            foreach (var p in Process.GetProcessesByName(name)) {
                if (p.MainWindowHandle != IntPtr.Zero) {
                    hwnd = p.MainWindowHandle;
                    break;
                }
            }
            if (hwnd != IntPtr.Zero) break;
        }

        if (hwnd == IntPtr.Zero) {
            Console.Error.WriteLine("Error: MainWindowHandle not found.");
            return;
        }

        long currentStyle = GetWindowLongPtr(hwnd, GWL_EXSTYLE).ToInt64();
        if (action == "enable-clickthrough") {
            long newStyle = currentStyle | WS_EX_LAYERED | WS_EX_TRANSPARENT;
            SetWindowLongPtr(hwnd, GWL_EXSTYLE, new IntPtr(newStyle));
            Console.WriteLine("Enabled clickthrough.");
        } else if (action == "disable-clickthrough") {
            long newStyle = currentStyle & ~WS_EX_TRANSPARENT;
            SetWindowLongPtr(hwnd, GWL_EXSTYLE, new IntPtr(newStyle));
            Console.WriteLine("Disabled clickthrough.");
        }
    }
}
