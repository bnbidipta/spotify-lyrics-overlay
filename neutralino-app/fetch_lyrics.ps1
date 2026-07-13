param(
    [string]$trackName,
    [string]$artistName
)

$Output = @{
    synced = $false
    lyrics = "Lyrics not found for this track."
}

# Prepare search titles
$originalTrack = $trackName.Trim()

# Clean track name to extract the main title
$cleanTrack = $trackName
if ($cleanTrack -like "* - *") {
    $parts = $cleanTrack -split " - "
    if ($parts[0].Trim()) {
        $cleanTrack = $parts[0].Trim()
    }
}
$cleanTrack = $cleanTrack -replace "\s*\((feat|with|featuring)\.?\s+[^)]+\)", ""
$cleanTrack = $cleanTrack -replace "\s*\((Remastered|Deluxe|Expanded|Special|Anniversary)\s*[^)]*\)", ""
$cleanTrack = $cleanTrack -replace "\s*-\s*(Remastered|Deluxe|Expanded|Special|Anniversary)\s*.*", ""
$cleanTrack = $cleanTrack -replace "\s*\((Live|Acoustic|Radio Edit|Remix|Edit|Mix)\)", ""
$cleanTrack = $cleanTrack.Trim()

# Clean artist name
$cleanArtist = $artistName -replace "\s*(feat|with|featuring)\.?\s+.*", ""
$cleanArtist = ($cleanArtist -split ",")[0].Trim()

$plainFallback = $null

# Helper function to query Lrclib
function Get-LrclibLyrics([string]$track, [string]$artist) {
    try {
        $trackEsc = [uri]::EscapeDataString($track)
        $artistEsc = [uri]::EscapeDataString($artist)
        $url = "https://lrclib.net/api/get?artist_name=$artistEsc&track_name=$trackEsc"
        
        $response = Invoke-RestMethod -Uri $url -Method Get -TimeoutSec 2
        return $response
    } catch {
        return $null
    }
}

# Helper function to query NetEase
function Get-NetEaseLyrics([string]$track, [string]$artist) {
    try {
        $query = [uri]::EscapeDataString("$artist $track")
        $searchUrl = "https://music.163.com/api/search/get/web?s=$query&type=1&limit=5"
        
        $searchResponse = Invoke-RestMethod -Uri $searchUrl -Method Get -TimeoutSec 2
        if ($searchResponse -and $searchResponse.result) {
            $resultObj = ConvertFrom-Json $searchResponse.result
            if ($resultObj.songs -and $resultObj.songs.Count -gt 0) {
                $songId = $resultObj.songs[0].id
                $lyricUrl = "https://music.163.com/api/song/lyric?os=pc&id=$songId&lv=-1&kv=-1&tv=-1"
                $lyricResponse = Invoke-RestMethod -Uri $lyricUrl -Method Get -TimeoutSec 2
                if ($lyricResponse -and $lyricResponse.lrc -and $lyricResponse.lrc.lyric) {
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

        $tokenFile = Join-Path $PSScriptRoot "musixmatch_token.txt"
        $userToken = $null

        if (Test-Path $tokenFile) {
            try { $userToken = (Get-Content -Path $tokenFile -Raw).Trim() } catch {}
        }

        if (-not $userToken) {
            $tokenUri = "https://apic-desktop.musixmatch.com/ws/1.1/token.get?app_id=web-desktop-app-v1.0&user_language=en"
            $tokenResponse = Invoke-RestMethod -Uri $tokenUri -Method Get -Headers $headers -WebSession $session -TimeoutSec 2
            $userToken = $tokenResponse.message.body.user_token
            if ($userToken) {
                $userToken | Out-File -FilePath $tokenFile -NoNewline -Encoding utf8
            }
        }

        if ($userToken) {
            $trackEsc = [uri]::EscapeDataString($track)
            $artistEsc = [uri]::EscapeDataString($artist)
            $searchUri = "https://apic-desktop.musixmatch.com/ws/1.1/track.search?q_track=$trackEsc&q_artist=$artistEsc&page_size=1&usertoken=$userToken&app_id=web-desktop-app-v1.0"
            $searchResponse = Invoke-RestMethod -Uri $searchUri -Method Get -Headers $headers -WebSession $session -TimeoutSec 2
            
            if ($searchResponse.message.header.status_code -eq 401) {
                Remove-Item $tokenFile -ErrorAction SilentlyContinue
                $tokenUri = "https://apic-desktop.musixmatch.com/ws/1.1/token.get?app_id=web-desktop-app-v1.0&user_language=en"
                $tokenResponse = Invoke-RestMethod -Uri $tokenUri -Method Get -Headers $headers -WebSession $session -TimeoutSec 2
                $userToken = $tokenResponse.message.body.user_token
                if ($userToken) {
                    $userToken | Out-File -FilePath $tokenFile -NoNewline -Encoding utf8
                    $searchUri = "https://apic-desktop.musixmatch.com/ws/1.1/track.search?q_track=$trackEsc&q_artist=$artistEsc&page_size=1&usertoken=$userToken&app_id=web-desktop-app-v1.0"
                    $searchResponse = Invoke-RestMethod -Uri $searchUri -Method Get -Headers $headers -WebSession $session -TimeoutSec 2
                }
            }

            $trackList = $searchResponse.message.body.track_list
            if ($trackList -and $trackList.Count -gt 0) {
                $foundTrack = $trackList[0].track
                $trackId = $foundTrack.track_id

                if ($foundTrack.has_subtitles -eq 1) {
                    $subtitleUri = "https://apic-desktop.musixmatch.com/ws/1.1/track.subtitle.get?track_id=$trackId&subtitle_format=lrc&usertoken=$userToken&app_id=web-desktop-app-v1.0"
                    $subResponse = Invoke-RestMethod -Uri $subtitleUri -Method Get -Headers $headers -WebSession $session -TimeoutSec 2
                    return @{ synced = $true; lyrics = $subResponse.message.body.subtitle.subtitle_body }
                } elseif ($foundTrack.has_lyrics -eq 1) {
                    $lyricsUri = "https://apic-desktop.musixmatch.com/ws/1.1/track.lyrics.get?track_id=$trackId&usertoken=$userToken&app_id=web-desktop-app-v1.0"
                    $lyricsResponse = Invoke-RestMethod -Uri $lyricsUri -Method Get -Headers $headers -WebSession $session -TimeoutSec 2
                    $body = $lyricsResponse.message.body.lyrics.lyrics_body
                    if ($body) {
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
        $response = Invoke-RestMethod -Uri $url -Method Get -TimeoutSec 2
        if ($response -and $response.lyrics) {
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

# --- PASS 2: Main Title Match (Irrespective of what is after the title) ---
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
