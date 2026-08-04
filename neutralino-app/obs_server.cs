using System;
using System.Collections.Concurrent;
using System.IO;
using System.Net;
using System.Net.WebSockets;
using System.Text;
using System.Threading;
using System.Threading.Tasks;

class ObsServer {
    private static ConcurrentBag<WebSocket> _clients = new ConcurrentBag<WebSocket>();
    private static string _lastStateJson = "{\"currentLine\":\"Waiting for Spotify...\"}";

    static void Main(string[] args) {
        int port = 5001;
        for (int i = 0; i < args.Length; i++) {
            if (args[i] == "-Port" && i + 1 < args.Length) {
                int.TryParse(args[i + 1], out port);
            }
        }

        HttpListener listener = new HttpListener();
        listener.Prefixes.Add("http://127.0.0.1:" + port + "/");

        try {
            listener.Start();
            Console.WriteLine("{\"status\":\"running\",\"port\":" + port + "}");
        } catch (Exception ex) {
            Console.WriteLine("{\"error\":\"Failed to start OBS listener: " + ex.Message + "\"}");
            return;
        }

        Task.Run(async () => {
            while (listener.IsListening) {
                try {
                    HttpListenerContext context = await listener.GetContextAsync();
                    ProcessRequest(context);
                } catch (Exception) {
                    // Listener stopped or error
                }
            }
        });

        // Keep process running until termination signal
        ManualResetEvent quitEvent = new ManualResetEvent(false);
        Console.CancelKeyPress += (sender, e) => quitEvent.Set();
        quitEvent.WaitOne();

        try { listener.Stop(); } catch { }
    }

    private static async void ProcessRequest(HttpListenerContext context) {
        HttpListenerRequest request = context.Request;
        HttpListenerResponse response = context.Response;

        // CORS headers
        response.Headers.Add("Access-Control-Allow-Origin", "*");
        response.Headers.Add("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
        response.Headers.Add("Access-Control-Allow-Headers", "Content-Type");

        if (request.HttpMethod == "OPTIONS") {
            response.StatusCode = 200;
            response.Close();
            return;
        }

        string path = request.Url.AbsolutePath.ToLower();

        // WebSocket Upgrade
        if (context.Request.IsWebSocketRequest) {
            try {
                HttpListenerWebSocketContext wsContext = await context.AcceptWebSocketAsync(subProtocol: null);
                WebSocket ws = wsContext.WebSocket;
                _clients.Add(ws);

                // Send latest state on connect
                byte[] initBuffer = Encoding.UTF8.GetBytes(_lastStateJson);
                await ws.SendAsync(new ArraySegment<byte>(initBuffer), WebSocketMessageType.Text, true, CancellationToken.None);

                // Listen loop for close/disconnect
                byte[] rcvBuffer = new byte[1024];
                while (ws.State == WebSocketState.Open) {
                    WebSocketReceiveResult result = await ws.ReceiveAsync(new ArraySegment<byte>(rcvBuffer), CancellationToken.None);
                    if (result.MessageType == WebSocketMessageType.Close) {
                        await ws.CloseAsync(WebSocketCloseStatus.NormalClosure, "Closing", CancellationToken.None);
                        break;
                    }
                }
            } catch { }
            return;
        }

        // POST /update endpoint from main.js
        if (request.HttpMethod == "POST" && (path == "/update" || path == "/update/")) {
            using (StreamReader reader = new StreamReader(request.InputStream, Encoding.UTF8)) {
                string json = reader.ReadToEnd();
                if (!string.IsNullOrEmpty(json)) {
                    _lastStateJson = json;
                    Broadcast(json);
                }
            }
            byte[] okBuf = Encoding.UTF8.GetBytes("{\"status\":\"ok\"}");
            response.ContentType = "application/json";
            response.ContentLength64 = okBuf.Length;
            await response.OutputStream.WriteAsync(okBuf, 0, okBuf.Length);
            response.Close();
            return;
        }

        // GET / or /overlay - Serve OBS overlay HTML page
        if (request.HttpMethod == "GET" && (path == "/" || path == "/overlay" || path == "/overlay/")) {
            string html = GetOverlayHtml();
            byte[] htmlBuf = Encoding.UTF8.GetBytes(html);
            response.ContentType = "text/html; charset=utf-8";
            response.ContentLength64 = htmlBuf.Length;
            await response.OutputStream.WriteAsync(htmlBuf, 0, htmlBuf.Length);
            response.Close();
            return;
        }

        // 404 default
        response.StatusCode = 404;
        response.Close();
    }

    private static void Broadcast(string message) {
        byte[] buffer = Encoding.UTF8.GetBytes(message);
        ArraySegment<byte> segment = new ArraySegment<byte>(buffer);

        foreach (WebSocket ws in _clients.ToArray()) {
            if (ws.State == WebSocketState.Open) {
                Task.Run(async () => {
                    try {
                        await ws.SendAsync(segment, WebSocketMessageType.Text, true, CancellationToken.None);
                    } catch { }
                });
            }
        }
    }

    private static string GetOverlayHtml() {
        return @"<!DOCTYPE html>
<html lang=""en"">
<head>
    <meta charset=""UTF-8"">
    <title>Spotify Lyrics OBS Overlay</title>
    <link rel=""preconnect"" href=""https://fonts.googleapis.com"">
    <link rel=""preconnect"" href=""https://fonts.gstatic.com"" crossorigin>
    <link href=""https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&display=swap"" rel=""stylesheet"">
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        html, body {
            width: 100%; height: 100%;
            background: transparent;
            overflow: hidden;
            font-family: 'Inter', 'Segoe UI', system-ui, sans-serif;
            color: #ffffff;
            user-select: none;
        }
        #obs-container {
            padding: 20px;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            text-align: center;
            width: 100%;
            height: 100%;
        }
        #header-box {
            display: flex;
            align-items: center;
            gap: 10px;
            margin-bottom: 8px;
        }
        #album-art {
            width: 34px;
            height: 34px;
            border-radius: 8px;
            object-fit: cover;
            display: none;
            box-shadow: 0 4px 12px rgba(0,0,0,0.6);
            border: 1px solid rgba(255,255,255,0.2);
        }
        #track-info {
            font-size: 15px;
            font-weight: 700;
            color: rgba(255,255,255,0.95);
            text-shadow: -1.5px -1.5px 0 #000, 1.5px -1.5px 0 #000, -1.5px 1.5px 0 #000, 1.5px 1.5px 0 #000, 0 3px 6px rgba(0,0,0,0.9);
            letter-spacing: 0.2px;
        }
        #progress-track {
            width: 80%;
            max-width: 320px;
            height: 4px;
            background: rgba(255,255,255,0.2);
            border-radius: 3px;
            margin-bottom: 14px;
            overflow: hidden;
            box-shadow: 0 2px 4px rgba(0,0,0,0.8);
        }
        #progress-fill {
            width: 0%;
            height: 100%;
            background: #1DB954;
            transition: width 0.3s linear;
            border-radius: 3px;
        }
        #lyrics-box {
            display: flex;
            flex-direction: column;
            gap: 10px;
            width: 100%;
            max-width: 600px;
        }
        .lyric-line {
            font-size: 22px;
            font-weight: 700;
            line-height: 1.35;
            transition: all 0.25s ease-out;
            text-shadow: -2px -2px 0 #000, 2px -2px 0 #000, -2px 2px 0 #000, 2px 2px 0 #000, 0 4px 8px rgba(0,0,0,0.95);
            word-wrap: break-word;
        }
        .lyric-line.prev {
            font-size: 16px;
            opacity: 0.55;
            color: #d1d1d1;
        }
        .lyric-line.current {
            font-size: 25px;
            color: #1DB954;
            opacity: 1;
            transform: scale(1.03);
            text-shadow: -2px -2px 0 #000, 2px -2px 0 #000, -2px 2px 0 #000, 2px 2px 0 #000, 0 0 12px rgba(29,185,84,0.4);
        }
        .lyric-line.next {
            font-size: 16px;
            opacity: 0.55;
            color: #d1d1d1;
        }
    </style>
</head>
<body>
    <div id=""obs-container"">
        <div id=""header-box"">
            <img id=""album-art"" src="""" alt=""art"" />
            <span id=""track-info"">Spotify Lyrics</span>
        </div>
        <div id=""progress-track"">
            <div id=""progress-fill""></div>
        </div>
        <div id=""lyrics-box"">
            <div id=""prev-line"" class=""lyric-line prev""></div>
            <div id=""current-line"" class=""lyric-line current"">Waiting for Spotify...</div>
            <div id=""next-line"" class=""lyric-line next""></div>
        </div>
    </div>
    <script>
        function connect() {
            const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            const ws = new WebSocket(protocol + '//' + window.location.host);
            ws.onmessage = function(event) {
                try {
                    const data = JSON.parse(event.data);
                    if (data.trackName) {
                        document.getElementById('track-info').innerText = data.artistName ? (data.trackName + ' - ' + data.artistName) : data.trackName;
                    }
                    if (data.albumArt) {
                        const art = document.getElementById('album-art');
                        art.src = data.albumArt;
                        art.style.display = 'block';
                    }
                    if (data.durationMs > 0 && data.progressMs !== undefined) {
                        const pct = Math.min(100, Math.max(0, (data.progressMs / data.durationMs) * 100));
                        document.getElementById('progress-fill').style.width = pct + '%';
                    }
                    document.getElementById('prev-line').innerText = data.prevLine || '';
                    document.getElementById('current-line').innerText = data.currentLine || '';
                    document.getElementById('next-line').innerText = data.nextLine || '';
                } catch(e) {}
            };
            ws.onclose = function() {
                setTimeout(connect, 2000);
            };
            ws.onerror = function() {
                ws.close();
            };
        }
        connect();
    </script>
</body>
</html>";
    }
}
