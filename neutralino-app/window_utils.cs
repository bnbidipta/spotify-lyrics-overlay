using System;
using System.Diagnostics;
using System.Drawing;
using System.Runtime.InteropServices;
using System.Windows.Forms;
using Microsoft.Win32;

class WindowUtils {
    [DllImport("user32.dll")]
    static extern int GetWindowLong(IntPtr hWnd, int nIndex);

    [DllImport("user32.dll")]
    static extern int SetWindowLong(IntPtr hWnd, int nIndex, int dwNewLong);

    const int GWL_EXSTYLE = -20;
    const int WS_EX_LAYERED = 0x80000;
    const int WS_EX_TRANSPARENT = 0x20;

    static void Main(string[] args) {
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

        if (action == "enable-autostart") {
            try {
                if (string.IsNullOrEmpty(exePath)) {
                    exePath = Process.GetCurrentProcess().MainModule.FileName;
                }
                using (RegistryKey key = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Run", true)) {
                    if (key != null) {
                        key.SetValue("SpotifyLyricsOverlay", "\"" + exePath + "\"");
                        Console.WriteLine("{\"status\":\"success\",\"autostart\":true}");
                    }
                }
            } catch (Exception ex) {
                Console.WriteLine("{\"error\":\"" + ex.Message.Replace("\"", "'") + "\"}");
            }
            return;
        }

        if (action == "disable-autostart") {
            try {
                using (RegistryKey key = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Run", true)) {
                    if (key != null) {
                        key.DeleteValue("SpotifyLyricsOverlay", false);
                        Console.WriteLine("{\"status\":\"success\",\"autostart\":false}");
                    }
                }
            } catch (Exception ex) {
                Console.WriteLine("{\"error\":\"" + ex.Message.Replace("\"", "'") + "\"}");
            }
            return;
        }

        if (action == "check-autostart") {
            try {
                bool exists = false;
                using (RegistryKey key = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Run", false)) {
                    if (key != null) {
                        object val = key.GetValue("SpotifyLyricsOverlay");
                        if (val != null) exists = true;
                    }
                }
                Console.WriteLine("{\"autostart\":" + (exists ? "true" : "false") + "}");
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
        Process[] processes = Process.GetProcessesByName("spotify-lyrics-overlay");
        foreach (var p in processes) {
            if (p.MainWindowHandle != IntPtr.Zero) {
                hwnd = p.MainWindowHandle;
                break;
            }
        }

        if (hwnd == IntPtr.Zero) {
            Console.Error.WriteLine("Error: MainWindowHandle not found.");
            return;
        }

        int currentStyle = GetWindowLong(hwnd, GWL_EXSTYLE);
        if (action == "enable-clickthrough") {
            int newStyle = currentStyle | WS_EX_LAYERED | WS_EX_TRANSPARENT;
            SetWindowLong(hwnd, GWL_EXSTYLE, newStyle);
            Console.WriteLine("Enabled clickthrough.");
        } else if (action == "disable-clickthrough") {
            int newStyle = currentStyle & ~WS_EX_TRANSPARENT;
            SetWindowLong(hwnd, GWL_EXSTYLE, newStyle);
            Console.WriteLine("Disabled clickthrough.");
        }
    }
}
