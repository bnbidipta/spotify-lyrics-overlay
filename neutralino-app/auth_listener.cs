using System;
using System.Net;
using System.Text;
using System.Threading;

class AuthListener {
    static void Main(string[] args) {
        int startPort = 8888;
        string expectedState = "";
        for (int i = 0; i < args.Length; i++) {
            if (args[i] == "-Port" && i + 1 < args.Length) int.TryParse(args[i+1], out startPort);
            if (args[i] == "-ExpectedState" && i + 1 < args.Length) expectedState = args[i+1];
        }

        HttpListener listener = new HttpListener();
        int actualPort = startPort;
        bool started = false;

        // Try requested port first, then scan next 15 ports if port is busy/access denied
        for (int p = startPort; p < startPort + 16; p++) {
            try {
                listener = new HttpListener();
                listener.Prefixes.Add("http://127.0.0.1:" + p + "/callback/");
                listener.Prefixes.Add("http://127.0.0.1:" + p + "/");
                try { listener.Prefixes.Add("http://localhost:" + p + "/callback/"); } catch {}
                try { listener.Prefixes.Add("http://localhost:" + p + "/"); } catch {}
                listener.Start();
                actualPort = p;
                started = true;
                break;
            } catch {
                try { listener.Close(); } catch {}
                continue;
            }
        }

        if (!started) {
            Console.WriteLine("{\"error\":\"Failed to bind local listener on ports " + startPort + ".." + (startPort + 15) + "\"}");
            return;
        }

        // Wait for incoming request with a 2-minute (120s) safety timeout
        HttpListenerContext context = null;
        try {
            IAsyncResult result = listener.BeginGetContext(null, null);
            bool signaled = result.AsyncWaitHandle.WaitOne(120000, true);
            if (signaled) {
                context = listener.EndGetContext(result);
            } else {
                listener.Stop();
                Console.WriteLine("{\"error\":\"Authentication timed out after 120s\"}");
                return;
            }
        } catch (Exception ex) {
            try { listener.Stop(); } catch {}
            Console.WriteLine("{\"error\":\"Listener error: " + ex.Message.Replace("\"", "'") + "\"}");
            return;
        }

        HttpListenerRequest request = context.Request;
        HttpListenerResponse response = context.Response;

        string code = request.QueryString["code"];
        string state = request.QueryString["state"];
        string error = request.QueryString["error"];

        string responseString = "";
        if (!string.IsNullOrEmpty(error)) {
            responseString = "<!DOCTYPE html><html><head><meta charset='utf-8'><title>Login Cancelled</title></head><body style='font-family:system-ui,-apple-system,sans-serif;text-align:center;padding:60px 20px;background:#121212;color:white;'><div style='font-size:48px;margin-bottom:10px;'>🔒</div><h2 style='color:#ffaa00;'>Login Cancelled</h2><p style='color:#cccccc;'>Spotify authorization was not completed (" + System.Net.WebUtility.HtmlEncode(error) + "). You can return to Overtone.</p></body></html>";
            response.StatusCode = 200;
        } else if (state != expectedState) {
            responseString = "<!DOCTYPE html><html><head><meta charset='utf-8'><title>Auth Error</title></head><body style='font-family:system-ui,-apple-system,sans-serif;text-align:center;padding:60px 20px;background:#121212;color:white;'><h2 style='color:#ff5555;'>⚠️ Security State Mismatch</h2><p style='color:#aaaaaa;'>The authentication session state did not match. Please return to the overlay and try logging in again.</p></body></html>";
            response.StatusCode = 400;
        } else {
            responseString = "<!DOCTYPE html><html><head><meta charset='utf-8'><title>Login Successful</title></head><body style='font-family:system-ui,-apple-system,sans-serif;text-align:center;padding:60px 20px;background:#121212;color:white;'><div style='font-size:48px;margin-bottom:10px;'>🟢</div><h2 style='color:#1DB954;'>Login Successful!</h2><p style='color:#cccccc;'>You can close this browser tab and return to Overtone.</p></body></html>";
            response.StatusCode = 200;
        }

        try {
            byte[] buffer = Encoding.UTF8.GetBytes(responseString);
            response.ContentType = "text/html; charset=utf-8";
            response.ContentLength64 = buffer.Length;
            using (System.IO.Stream output = response.OutputStream) {
                output.Write(buffer, 0, buffer.Length);
            }
        } catch {}

        try { listener.Stop(); } catch {}

        if (!string.IsNullOrEmpty(error)) {
            Console.WriteLine("{\"error\":\"Spotify login cancelled: " + EscapeJson(error) + "\"}");
        } else if (state == expectedState && !string.IsNullOrEmpty(code)) {
            Console.WriteLine("{\"code\":\"" + EscapeJson(code) + "\",\"state\":\"" + EscapeJson(state) + "\",\"port\":" + actualPort + "}");
        } else {
            Console.WriteLine("{\"error\":\"State mismatch or missing authorization code\"}");
        }
    }

    static string EscapeJson(string s) {
        if (s == null) return "";
        return s.Replace("\\", "\\\\").Replace("\"", "\\\"").Replace("\r", "\\r").Replace("\n", "\\n");
    }
}
