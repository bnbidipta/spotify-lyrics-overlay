param(
    [Parameter(Mandatory)][string]$EncodedArgs
)

# Force stdout encoding to UTF-8 to support non-English characters
try {
    [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
} catch [System.IO.IOException] {}
$OutputEncoding = [System.Text.Encoding]::UTF8

$Output = @{
    synced = $false
    lyrics = "Lyrics not found for this track."
}

# Parse JSON arguments securely from Base64
try {
    $argBytes = [System.Convert]::FromBase64String($EncodedArgs)
    $argStr = [System.Text.Encoding]::UTF8.GetString($argBytes)
    $argsObj = ConvertFrom-Json $argStr
    
    $track = $argsObj.track
    if ($track.Length -gt 200) { $track = $track.Substring(0, 200) }
    $artist = $argsObj.artist
    if ($artist.Length -gt 200) { $artist = $artist.Substring(0, 200) }
} catch {
    $Output | ConvertTo-Json -Compress
    exit
}

if (-not $track -or -not $artist) {
    $Output | ConvertTo-Json -Compress
    exit
}

# Prepare search titles
$originalTrack = $track.Trim()

# Suffix cleaning regex matching suffixes strictly at the end of the string
$cleanTrack = $track
$cleanTrack = $cleanTrack -replace "\s*\((feat|with|featuring)\.?\s+[^)]+\)$", ""
$cleanTrack = $cleanTrack -replace "\s*\((Remastered|Deluxe|Expanded|Special|Anniversary|Live|Acoustic|Radio Edit|Remix|Edit|Mix)\s*[^)]*\)$", ""
$cleanTrack = $cleanTrack -replace "\s*-\s*(Remastered|Deluxe|Expanded|Special|Anniversary|Live|Acoustic|Radio Edit|Remix|Edit|Mix|feat|with|featuring)\s*.*$", ""
$cleanTrack = $cleanTrack.Trim()

# Clean artist name
$cleanArtist = $artist -replace "\s*(feat|with|featuring)\.?\s+.*$", ""
$cleanArtist = ($cleanArtist -split ",")[0].Trim()

$plainFallback = $null

# Global Headers
$globalHeaders = @{
    "User-Agent" = "Spotify-Lyrics-Overlay/2.0"
}

# Helper function to validate response payload size
function IsPayloadValid([string]$payload) {
    if (-not $payload) { return $false }
    # Reject files larger than 100KB to prevent memory exhaustion DoS
    if ($payload.Length -gt 100000) { return $false }
    return $true
}

# Helper function to query Lrclib
function Get-LrclibLyrics([string]$track, [string]$artist) {
    try {
        $trackEsc = [uri]::EscapeDataString($track)
        $artistEsc = [uri]::EscapeDataString($artist)
        $url = "https://lrclib.net/api/get?artist_name=$artistEsc&track_name=$trackEsc"
        
        $response = Invoke-RestMethod -Uri $url -Method Get -Headers $globalHeaders -TimeoutSec 5
        if ($response -and (IsPayloadValid $response.syncedLyrics -or IsPayloadValid $response.plainLyrics)) {
            return $response
        }
    } catch {}
    return $null
}

# Helper function to query NetEase
function Get-NetEaseLyrics([string]$track, [string]$artist) {
    try {
        $query = [uri]::EscapeDataString("$artist $track")
        $searchUrl = "https://music.163.com/api/search/get/web?s=$query&type=1&limit=5"
        
        $searchResponse = Invoke-RestMethod -Uri $searchUrl -Method Get -Headers $globalHeaders -TimeoutSec 5
        if ($searchResponse -and $searchResponse.result) {
            $resultObj = $null
            try {
                $resultObj = ConvertFrom-Json $searchResponse.result
            } catch {
                return $null
            }
            if ($resultObj -and $resultObj.songs -and $resultObj.songs.Count -gt 0) {
                $songId = $resultObj.songs[0].id
                $lyricUrl = "https://music.163.com/api/song/lyric?os=pc&id=$songId&lv=-1&kv=-1&tv=-1"
                $lyricResponse = Invoke-RestMethod -Uri $lyricUrl -Method Get -Headers $globalHeaders -TimeoutSec 5
                if ($lyricResponse -and $lyricResponse.lrc -and (IsPayloadValid $lyricResponse.lrc.lyric)) {
                    return $lyricResponse.lrc.lyric
                }
            }
        }
    } catch {}
    return $null
}

# Helper function to query Musixmatch
function Get-MusixmatchLyrics([string]$track, [string]$artist) {
    try {
        $headers = @{
            "User-Agent" = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Musixmatch/0.19.4 Chrome/58.0.3029.110 Electron/1.7.6 Safari/537.36"
        }
        $session = New-Object Microsoft.PowerShell.Commands.WebRequestSession
        $cookie1 = New-Object System.Net.Cookie("AWSELB", "0", "/", "apic-desktop.musixmatch.com")
        $session.Cookies.Add($cookie1)
        $cookie2 = New-Object System.Net.Cookie("AWSELBCORS", "0", "/", "apic-desktop.musixmatch.com")
        $session.Cookies.Add($cookie2)

        # Write to secure writeable APPDATA folder to prevent permissions failures in Program Files
        $appDataFolder = Join-Path $env:APPDATA "SpotifyLyricsOverlay"
        if (-not (Test-Path $appDataFolder)) {
            New-Item -ItemType Directory -Path $appDataFolder -Force | Out-Null
        }
        $tokenFile = Join-Path $appDataFolder "musixmatch_token.txt"
        $userToken = $null

        if (Test-Path $tokenFile) {
            try { $userToken = (Get-Content -Path $tokenFile -Raw).Trim() } catch {}
        }

        if (-not $userToken) {
            $tokenUri = "https://apic-desktop.musixmatch.com/ws/1.1/token.get?app_id=web-desktop-app-v1.0&user_language=en"
            $tokenResponse = Invoke-RestMethod -Uri $tokenUri -Method Get -Headers $headers -WebSession $session -TimeoutSec 5
            $userToken = $tokenResponse.message.body.user_token
            if ($userToken) {
                $userToken | Out-File -FilePath $tokenFile -NoNewline -Encoding utf8
            }
        }

        if ($userToken) {
            $trackEsc = [uri]::EscapeDataString($track)
            $artistEsc = [uri]::EscapeDataString($artist)
            $searchUri = "https://apic-desktop.musixmatch.com/ws/1.1/track.search?q_track=$trackEsc&q_artist=$artistEsc&page_size=1&usertoken=$userToken&app_id=web-desktop-app-v1.0"
            $searchResponse = Invoke-RestMethod -Uri $searchUri -Method Get -Headers $headers -WebSession $session -TimeoutSec 5
            
            if ($searchResponse.message.header.status_code -eq 401) {
                Remove-Item $tokenFile -ErrorAction SilentlyContinue
                $tokenUri = "https://apic-desktop.musixmatch.com/ws/1.1/token.get?app_id=web-desktop-app-v1.0&user_language=en"
                $tokenResponse = Invoke-RestMethod -Uri $tokenUri -Method Get -Headers $headers -WebSession $session -TimeoutSec 5
                $userToken = $tokenResponse.message.body.user_token
                if ($userToken) {
                    $userToken | Out-File -FilePath $tokenFile -NoNewline -Encoding utf8
                    $searchUri = "https://apic-desktop.musixmatch.com/ws/1.1/track.search?q_track=$trackEsc&q_artist=$artistEsc&page_size=1&usertoken=$userToken&app_id=web-desktop-app-v1.0"
                    $searchResponse = Invoke-RestMethod -Uri $searchUri -Method Get -Headers $headers -WebSession $session -TimeoutSec 5
                }
            }

            $trackList = $searchResponse.message.body.track_list
            if ($trackList -and $trackList.Count -gt 0) {
                $foundTrack = $trackList[0].track
                $trackId = $foundTrack.track_id

                if ($foundTrack.has_subtitles -eq 1) {
                    $subtitleUri = "https://apic-desktop.musixmatch.com/ws/1.1/track.subtitle.get?track_id=$trackId&subtitle_format=lrc&usertoken=$userToken&app_id=web-desktop-app-v1.0"
                    $subResponse = Invoke-RestMethod -Uri $subtitleUri -Method Get -Headers $headers -WebSession $session -TimeoutSec 5
                    $body = $subResponse.message.body.subtitle.subtitle_body
                    if (IsPayloadValid $body) {
                        return @{ synced = $true; lyrics = $body }
                    }
                } elseif ($foundTrack.has_lyrics -eq 1) {
                    $lyricsUri = "https://apic-desktop.musixmatch.com/ws/1.1/track.lyrics.get?track_id=$trackId&usertoken=$userToken&app_id=web-desktop-app-v1.0"
                    $lyricsResponse = Invoke-RestMethod -Uri $lyricsUri -Method Get -Headers $headers -WebSession $session -TimeoutSec 5
                    $body = $lyricsResponse.message.body.lyrics.lyrics_body
                    if (IsPayloadValid $body) {
                        $body = $body -replace "\*\*\*\*\*\ *[\s\S]*", ""
                        return @{ synced = $false; lyrics = $body.Trim() }
                    }
                }
            }
        }
    } catch {}
    return $null
}

# Helper function to query Lyrics.ovh
function Get-LyricsOvh([string]$track, [string]$artist) {
    try {
        $trackEsc = [uri]::EscapeDataString($track)
        $artistEsc = [uri]::EscapeDataString($artist)
        $url = "https://api.lyrics.ovh/v1/$artistEsc/$trackEsc"
        $response = Invoke-RestMethod -Uri $url -Method Get -Headers $globalHeaders -TimeoutSec 5
        if ($response -and (IsPayloadValid $response.lyrics)) {
            return $response.lyrics
        }
    } catch {}
    return $null
}

# --- PASS 1: Exact Version Match ---
if ($originalTrack -ne $cleanTrack) {
    # Check Lrclib
    $lrclibObj = Get-LrclibLyrics $originalTrack $cleanArtist
    if ($lrclibObj) {
        if ($lrclibObj.syncedLyrics) {
            $Output.synced = $true
            $Output.lyrics = $lrclibObj.syncedLyrics
            $Output | ConvertTo-Json -Compress
            exit
        } elseif ($lrclibObj.plainLyrics) {
            $plainFallback = $lrclibObj.plainLyrics
        }
    }

    # Check NetEase
    $neteaseLrc = Get-NetEaseLyrics $originalTrack $cleanArtist
    if ($neteaseLrc) {
        $Output.synced = $true
        $Output.lyrics = $neteaseLrc
        $Output | ConvertTo-Json -Compress
        exit
    }

    # Check Musixmatch
    $mmObj = Get-MusixmatchLyrics $originalTrack $cleanArtist
    if ($mmObj) {
        if ($mmObj.synced) {
            $Output.synced = $true
            $Output.lyrics = $mmObj.lyrics
            $Output | ConvertTo-Json -Compress
            exit
        } elseif ($mmObj.lyrics -and -not $plainFallback) {
            $plainFallback = $mmObj.lyrics
        }
    }
}

# --- PASS 2: Main Title Match ---
# Check Lrclib
$lrclibObj = Get-LrclibLyrics $cleanTrack $cleanArtist
if ($lrclibObj) {
    if ($lrclibObj.syncedLyrics) {
        $Output.synced = $true
        $Output.lyrics = $lrclibObj.syncedLyrics
        $Output | ConvertTo-Json -Compress
        exit
    } elseif ($lrclibObj.plainLyrics -and -not $plainFallback) {
        $plainFallback = $lrclibObj.plainLyrics
    }
}

# Check NetEase
$neteaseLrc = Get-NetEaseLyrics $cleanTrack $cleanArtist
if ($neteaseLrc) {
    $Output.synced = $true
    $Output.lyrics = $neteaseLrc
    $Output | ConvertTo-Json -Compress
    exit
}

# Check Musixmatch
$mmObj = Get-MusixmatchLyrics $cleanTrack $cleanArtist
if ($mmObj) {
    if ($mmObj.synced) {
        $Output.synced = $true
        $Output.lyrics = $mmObj.lyrics
        $Output | ConvertTo-Json -Compress
        exit
    } elseif ($mmObj.lyrics -and -not $plainFallback) {
        $plainFallback = $mmObj.lyrics
    }
}

# Check Lyrics.ovh as quaternary fallback
if (-not $plainFallback) {
    $plainFallback = Get-LyricsOvh $cleanTrack $cleanArtist
}

# Return plain fallback if available
if ($plainFallback) {
    $Output.synced = $false
    $Output.lyrics = $plainFallback
}

$Output | ConvertTo-Json -Compress
