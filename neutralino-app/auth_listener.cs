using System;
using System.Net;
using System.Text;

class AuthListener {
    static void Main(string[] args) {
        int port = 8888;
        string expectedState = "";
        for (int i = 0; i < args.Length; i++) {
            if (args[i] == "-Port" && i + 1 < args.Length) port = int.Parse(args[i+1]);
            if (args[i] == "-ExpectedState" && i + 1 < args.Length) expectedState = args[i+1];
        }

        HttpListener listener = new HttpListener();
        listener.Prefixes.Add("http://127.0.0.1:" + port + "/");
        try {
            listener.Start();
        } catch (Exception ex) {
            Console.WriteLine("{\"error\":\"Failed to start listener: " + ex.Message + "\"}");
            return;
        }

        HttpListenerContext context = listener.GetContext();
        HttpListenerRequest request = context.Request;
        HttpListenerResponse response = context.Response;

        string code = request.QueryString["code"];
        string state = request.QueryString["state"];

        string responseString = "";
        if (state != expectedState) {
            responseString = "<html><head><meta charset='utf-8'></head><body style='font-family:sans-serif;text-align:center;padding-top:50px;background:#121212;color:white;'><h2>State mismatch error! Connection insecure.</h2></body></html>";
            response.StatusCode = 400;
        } else {
            responseString = "<html><head><meta charset='utf-8'></head><body style='font-family:sans-serif;text-align:center;padding-top:50px;background:#121212;color:white;'><h2>Login Successful!</h2><p>You can close this tab and return to the overlay.</p></body></html>";
            response.StatusCode = 200;
        }

        byte[] buffer = Encoding.UTF8.GetBytes(responseString);
        response.ContentLength64 = buffer.Length;
        System.IO.Stream output = response.OutputStream;
        output.Write(buffer, 0, buffer.Length);
        output.Close();

        listener.Stop();

        if (state == expectedState && !string.IsNullOrEmpty(code)) {
            Console.WriteLine("{\"code\":\"" + code + "\",\"state\":\"" + state + "\"}");
        } else {
            Console.WriteLine("{\"error\":\"State mismatch or missing code\"}");
        }
    }
}
