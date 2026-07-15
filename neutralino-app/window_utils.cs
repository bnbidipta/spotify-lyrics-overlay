using System;
using System.Diagnostics;
using System.Runtime.InteropServices;

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
        for (int i = 0; i < args.Length; i++) {
            if (args[i] == "-Action" && i + 1 < args.Length) {
                action = args[i+1];
            }
        }

        if (string.IsNullOrEmpty(action)) return;

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
