using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using System.Net;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Web.Script.Serialization;

class FetchLyrics {
    private static readonly string commonUserAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

    static FetchLyrics() {
        try {
            ServicePointManager.DefaultConnectionLimit = 25;
            ServicePointManager.Expect100Continue = false;
            ServicePointManager.SecurityProtocol = (SecurityProtocolType)3072 | SecurityProtocolType.Tls; // Tls12 | Tls
        } catch {}
    }

    struct ScraperResult {
        public bool Success;
        public bool Synced;
        public string Lyrics;
        public string Provider;
    }

    static void Main(string[] args) {
        Console.OutputEncoding = Encoding.UTF8;

        string encodedArgs = "";
        for (int i = 0; i < args.Length; i++) {
            if (args[i] == "-EncodedArgs" && i + 1 < args.Length) {
                encodedArgs = args[i+1];
            }
        }

        if (string.IsNullOrEmpty(encodedArgs)) {
            OutputError("Missing EncodedArgs");
            return;
        }

        string track = "";
        string artist = "";
        List<string> providers = new List<string>();

        try {
            byte[] bytes = Convert.FromBase64String(encodedArgs);
            string json = Encoding.UTF8.GetString(bytes);
            var serializer = new JavaScriptSerializer();
            var dict = serializer.Deserialize<Dictionary<string, object>>(json);
            track = (dict.ContainsKey("track") && dict["track"] != null) ? dict["track"].ToString().Trim() : "";
            artist = (dict.ContainsKey("artist") && dict["artist"] != null) ? dict["artist"].ToString().Trim() : "";
            if (dict.ContainsKey("providers")) {
                var list = (ArrayList)dict["providers"];
                foreach (var item in list) if (item != null) providers.Add(item.ToString());
            }
            if (providers.Count == 0) {
                providers.AddRange(new string[] { "lrclib", "netease", "musixmatch", "lyricsovh" });
            }
        } catch (Exception ex) {
            OutputError("Failed to decode arguments: " + ex.Message);
            return;
        }

        if (string.IsNullOrEmpty(track)) {
            OutputResult(false, "No song title provided.", "none");
            return;
        }

        string originalTrack = track;
        string cleanTrack = CleanTrackName(track);
        string cleanArtist = CleanArtistName(artist);

        // Divide into Tier 1 (faster / synced primary) and Tier 2 (fallback)
        List<string> tier1 = new List<string>();
        List<string> tier2 = new List<string>();
        foreach (var p in providers) {
            if (p == "lrclib" || p == "netease") tier1.Add(p);
            else if (p == "musixmatch" || p == "lyricsovh") tier2.Add(p);
        }

        ScraperResult bestResult = new ScraperResult { Success = false };

        // PASS 1: Exact Version Match
        if (originalTrack != cleanTrack) {
            if (tier1.Count > 0) {
                var results = RaceScrapers(tier1, originalTrack, cleanArtist, 2500);
                bestResult = SelectBest(results, tier1);
            }
            if (!bestResult.Success || !bestResult.Synced) {
                if (tier2.Count > 0) {
                    var results2 = RaceScrapers(tier2, originalTrack, cleanArtist, 2500);
                    var best2 = SelectBest(results2, tier2);
                    if (best2.Success && (best2.Synced || !bestResult.Success)) {
                        bestResult = best2;
                    }
                }
            }
        }

        if (bestResult.Success && bestResult.Synced) {
            OutputResult(true, bestResult.Lyrics, bestResult.Provider);
            return;
        }

        // PASS 2: Main Cleaned Title Match
        string plainFallback = (bestResult.Success && !bestResult.Synced) ? bestResult.Lyrics : null;
        string plainProvider = (bestResult.Success && !bestResult.Synced) ? bestResult.Provider : null;

        if (tier1.Count > 0) {
            var results = RaceScrapers(tier1, cleanTrack, cleanArtist, 2500);
            var cleanBest = SelectBest(results, tier1);
            if (cleanBest.Success && cleanBest.Synced) {
                OutputResult(true, cleanBest.Lyrics, cleanBest.Provider);
                return;
            } else if (cleanBest.Success && plainFallback == null) {
                plainFallback = cleanBest.Lyrics;
                plainProvider = cleanBest.Provider;
            }
        }

        if (tier2.Count > 0) {
            var results = RaceScrapers(tier2, cleanTrack, cleanArtist, 2500);
            var cleanBest2 = SelectBest(results, tier2);
            if (cleanBest2.Success && cleanBest2.Synced) {
                OutputResult(true, cleanBest2.Lyrics, cleanBest2.Provider);
                return;
            } else if (cleanBest2.Success && plainFallback == null) {
                plainFallback = cleanBest2.Lyrics;
                plainProvider = cleanBest2.Provider;
            }
        }

        if (plainFallback != null) {
            OutputResult(false, plainFallback, plainProvider);
        } else {
            OutputResult(false, "Lyrics not found for this track.", "none");
        }
    }

    static string CleanTrackName(string track) {
        if (string.IsNullOrEmpty(track)) return "";
        string clean = track;
        clean = Regex.Replace(clean, @"\s*-\s*(Remastered|Deluxe|Live|Expanded|Special|Anniversary|Radio Edit|Remix|Edit|Mix|Single Version|Mono|Stereo).*?$", "", RegexOptions.IgnoreCase);
        clean = Regex.Replace(clean, @"\s*\((feat|with|featuring)\.?\s+[^)]+\)\s*$", "", RegexOptions.IgnoreCase);
        clean = Regex.Replace(clean, @"\s*\((Remastered|Deluxe|Live|Expanded|Special|Anniversary|Radio Edit|Remix|Edit|Mix|Single Version|Mono|Stereo)[^)]*\)\s*$", "", RegexOptions.IgnoreCase);
        return clean.Trim();
    }

    static string CleanArtistName(string artist) {
        if (string.IsNullOrEmpty(artist)) return "";
        string clean = Regex.Replace(artist, @"\s*(feat|with|featuring)\.?\s+.*$", "", RegexOptions.IgnoreCase);
        string[] parts = clean.Split(',');
        return parts[0].Trim();
    }

    static Dictionary<string, ScraperResult> RaceScrapers(List<string> targetProviders, string track, string artist, int timeoutMs) {
        var results = new Dictionary<string, ScraperResult>();
        var threads = new List<Thread>();
        var lockObj = new object();

        foreach (var provider in targetProviders) {
            string p = provider;
            Thread t = new Thread(() => {
                ScraperResult res = new ScraperResult { Success = false, Provider = p };
                try {
                    if (p == "lrclib") res = QueryLrclib(track, artist);
                    else if (p == "netease") res = QueryNetEase(track, artist);
                    else if (p == "musixmatch") res = QueryMusixmatch(track, artist);
                    else if (p == "lyricsovh") res = QueryLyricsOvh(track, artist);
                    res.Provider = p;
                } catch {}
                lock (lockObj) {
                    results[p] = res;
                }
            });
            t.IsBackground = true;
            threads.Add(t);
            t.Start();
        }

        DateTime start = DateTime.Now;
        while ((DateTime.Now - start).TotalMilliseconds < timeoutMs) {
            bool allDone = true;
            foreach (var t in threads) {
                if (t.IsAlive) { allDone = false; break; }
            }
            if (allDone) break;
            Thread.Sleep(30);
        }

        return results;
    }

    static ScraperResult SelectBest(Dictionary<string, ScraperResult> results, List<string> priorityList) {
        foreach (var p in priorityList) {
            if (results.ContainsKey(p) && results[p].Success && results[p].Synced) {
                return results[p];
            }
        }
        foreach (var p in priorityList) {
            if (results.ContainsKey(p) && results[p].Success) {
                return results[p];
            }
        }
        return new ScraperResult { Success = false };
    }

    static string HttpGet(string url, int timeoutMs = 4000) {
        HttpWebRequest request = (HttpWebRequest)WebRequest.Create(url);
        request.Method = "GET";
        request.UserAgent = commonUserAgent;
        request.Timeout = timeoutMs;
        request.ReadWriteTimeout = timeoutMs;
        request.KeepAlive = true;
        request.AutomaticDecompression = DecompressionMethods.GZip | DecompressionMethods.Deflate;
        using (HttpWebResponse response = (HttpWebResponse)request.GetResponse())
        using (Stream stream = response.GetResponseStream())
        using (StreamReader reader = new StreamReader(stream, Encoding.UTF8)) {
            return reader.ReadToEnd();
        }
    }

    static ScraperResult QueryLrclib(string track, string artist) {
        try {
            string url = string.Format("https://lrclib.net/api/get?artist_name={0}&track_name={1}", Uri.EscapeDataString(artist), Uri.EscapeDataString(track));
            string json = HttpGet(url);
            var serializer = new JavaScriptSerializer();
            var dict = serializer.Deserialize<Dictionary<string, object>>(json);
            if (dict != null) {
                if (dict.ContainsKey("syncedLyrics") && dict["syncedLyrics"] != null && !string.IsNullOrEmpty(dict["syncedLyrics"].ToString())) {
                    return new ScraperResult { Success = true, Synced = true, Lyrics = dict["syncedLyrics"].ToString() };
                }
                if (dict.ContainsKey("plainLyrics") && dict["plainLyrics"] != null && !string.IsNullOrEmpty(dict["plainLyrics"].ToString())) {
                    return new ScraperResult { Success = true, Synced = false, Lyrics = dict["plainLyrics"].ToString() };
                }
            }
        } catch {}
        return new ScraperResult { Success = false };
    }

    static ScraperResult QueryNetEase(string track, string artist) {
        try {
            string query = Uri.EscapeDataString(artist + " " + track);
            string searchUrl = "https://music.163.com/api/search/get/web?s=" + query + "&type=1&limit=5";
            string searchJson = HttpGet(searchUrl);
            var serializer = new JavaScriptSerializer();
            var searchDict = serializer.Deserialize<Dictionary<string, object>>(searchJson);
            if (searchDict != null && searchDict.ContainsKey("result") && searchDict["result"] != null) {
                var resultObj = (Dictionary<string, object>)searchDict["result"];
                if (resultObj != null && resultObj.ContainsKey("songs") && resultObj["songs"] != null) {
                    var songs = (ArrayList)resultObj["songs"];
                    if (songs.Count > 0) {
                        var firstSong = (Dictionary<string, object>)songs[0];
                        if (firstSong != null && firstSong.ContainsKey("id")) {
                            object songId = firstSong["id"];
                            string lyricUrl = "https://music.163.com/api/song/lyric?os=pc&id=" + songId + "&lv=-1&kv=-1&tv=-1";
                            string lyricJson = HttpGet(lyricUrl);
                            var lyricDict = serializer.Deserialize<Dictionary<string, object>>(lyricJson);
                            if (lyricDict != null && lyricDict.ContainsKey("lrc") && lyricDict["lrc"] != null) {
                                var lrc = (Dictionary<string, object>)lyricDict["lrc"];
                                if (lrc != null && lrc.ContainsKey("lyric") && lrc["lyric"] != null) {
                                    return new ScraperResult { Success = true, Synced = true, Lyrics = lrc["lyric"].ToString() };
                                }
                            }
                        }
                    }
                }
            }
        } catch {}
        return new ScraperResult { Success = false };
    }

    static ScraperResult QueryMusixmatch(string track, string artist) {
        try {
            string appData = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
            string tokenDir = Path.Combine(appData, "Overtone");
            if (!Directory.Exists(tokenDir)) Directory.CreateDirectory(tokenDir);
            string tokenFile = Path.Combine(tokenDir, "musixmatch_token.txt");

            string userToken = "";
            if (File.Exists(tokenFile)) {
                try { userToken = File.ReadAllText(tokenFile).Trim(); } catch {}
            }

            if (string.IsNullOrEmpty(userToken)) {
                string tokenUri = "https://apic-desktop.musixmatch.com/ws/1.1/token.get?app_id=web-desktop-app-v1.0&user_language=en";
                string tokenJson = HttpGet(tokenUri);
                var serializer = new JavaScriptSerializer();
                var tokenDict = serializer.Deserialize<Dictionary<string, object>>(tokenJson);
                var message = (Dictionary<string, object>)tokenDict["message"];
                var bodyObj = (Dictionary<string, object>)message["body"];
                userToken = bodyObj["user_token"].ToString();
                if (!string.IsNullOrEmpty(userToken)) {
                    try { File.WriteAllText(tokenFile, userToken); } catch {}
                }
            }

            if (!string.IsNullOrEmpty(userToken)) {
                string searchUri = string.Format("https://apic-desktop.musixmatch.com/ws/1.1/track.search?q_track={0}&q_artist={1}&page_size=1&usertoken={2}&app_id=web-desktop-app-v1.0", Uri.EscapeDataString(track), Uri.EscapeDataString(artist), userToken);
                string searchJson = HttpGet(searchUri);
                var serializer = new JavaScriptSerializer();
                var searchDict = serializer.Deserialize<Dictionary<string, object>>(searchJson);
                var message = (Dictionary<string, object>)searchDict["message"];
                var header = (Dictionary<string, object>)message["header"];
                if (header["status_code"].ToString() == "401") {
                    try { File.Delete(tokenFile); } catch {}
                    return new ScraperResult { Success = false };
                }

                var bodyObj = (Dictionary<string, object>)message["body"];
                var trackList = (ArrayList)bodyObj["track_list"];
                if (trackList.Count > 0) {
                    var firstTrack = (Dictionary<string, object>)((Dictionary<string, object>)trackList[0])["track"];
                    string trackId = firstTrack["track_id"].ToString();
                    string hasSubtitles = firstTrack["has_subtitles"].ToString();
                    string hasLyrics = firstTrack["has_lyrics"].ToString();

                    if (hasSubtitles == "1") {
                        string subtitleUri = string.Format("https://apic-desktop.musixmatch.com/ws/1.1/track.subtitle.get?track_id={0}&subtitle_format=lrc&usertoken={1}&app_id=web-desktop-app-v1.0", trackId, userToken);
                        string subJson = HttpGet(subtitleUri);
                        var subDict = serializer.Deserialize<Dictionary<string, object>>(subJson);
                        var subMessage = (Dictionary<string, object>)subDict["message"];
                        var subBody = (Dictionary<string, object>)subMessage["body"];
                        var subtitle = (Dictionary<string, object>)subBody["subtitle"];
                        string body = subtitle["subtitle_body"].ToString();
                        return new ScraperResult { Success = true, Synced = true, Lyrics = body };
                    } else if (hasLyrics == "1") {
                        string lyricsUri = string.Format("https://apic-desktop.musixmatch.com/ws/1.1/track.lyrics.get?track_id={0}&usertoken={1}&app_id=web-desktop-app-v1.0", trackId, userToken);
                        string lyrJson = HttpGet(lyricsUri);
                        var lyrDict = serializer.Deserialize<Dictionary<string, object>>(lyrJson);
                        var lyrMessage = (Dictionary<string, object>)lyrDict["message"];
                        var lyrBody = (Dictionary<string, object>)lyrMessage["body"];
                        var lyricsObj = (Dictionary<string, object>)lyrBody["lyrics"];
                        string body = lyricsObj["lyrics_body"].ToString();
                        body = Regex.Replace(body, @"\*\*\*\*\*\ *[\s\S]*", "");
                        return new ScraperResult { Success = true, Synced = false, Lyrics = body.Trim() };
                    }
                }
            }
        } catch {}
        return new ScraperResult { Success = false };
    }

    static ScraperResult QueryLyricsOvh(string track, string artist) {
        try {
            string url = string.Format("https://api.lyrics.ovh/v1/{0}/{1}", Uri.EscapeDataString(artist), Uri.EscapeDataString(track));
            string json = HttpGet(url);
            var serializer = new JavaScriptSerializer();
            var dict = serializer.Deserialize<Dictionary<string, object>>(json);
            if (dict != null && dict.ContainsKey("lyrics") && dict["lyrics"] != null) {
                return new ScraperResult { Success = true, Synced = false, Lyrics = dict["lyrics"].ToString() };
            }
        } catch {}
        return new ScraperResult { Success = false };
    }

    static void OutputResult(bool synced, string lyrics, string provider = null) {
        var serializer = new JavaScriptSerializer();
        var result = new Dictionary<string, object> {
            { "synced", synced },
            { "lyrics", lyrics },
            { "provider", provider ?? "unknown" }
        };
        Console.WriteLine(serializer.Serialize(result));
    }

    static void OutputError(string message) {
        var serializer = new JavaScriptSerializer();
        var result = new Dictionary<string, object> {
            { "synced", false },
            { "lyrics", "Error: " + message }
        };
        Console.WriteLine(serializer.Serialize(result));
    }
}
