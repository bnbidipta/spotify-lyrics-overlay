param(
    [string]$trackName,
    [string]$artistName
)

$Output = @{
    synced = $false
    lyrics = "Lyrics not found for this track."
}

# Global Query Cleaning to maximize match rates across all providers
# 1. Clean track name: split on " - " (removes suffixes like "- Single Version")
$cleanTrack = $trackName
if ($cleanTrack -like "* - *") {
    $parts = $cleanTrack -split " - "
    if ($parts[0].Trim()) {
        $cleanTrack = $parts[0].Trim()
    }
}
# Strip feature brackets, remaster notations, and performance descriptors
$cleanTrack = $cleanTrack -replace "\s*\((feat|with|featuring)\.?\s+[^)]+\)", ""
$cleanTrack = $cleanTrack -replace "\s*\((Remastered|Deluxe|Expanded|Special|Anniversary)\s*[^)]*\)", ""
$cleanTrack = $cleanTrack -replace "\s*-\s*(Remastered|Deluxe|Expanded|Special|Anniversary)\s*.*", ""
$cleanTrack = $cleanTrack -replace "\s*\((Live|Acoustic|Radio Edit|Remix|Edit|Mix)\)", ""
$cleanTrack = $cleanTrack.Trim()

# 2. Clean artist name: strip multiple artists or features
$cleanArtist = $artistName -replace "\s*(feat|with|featuring)\.?\s+.*", ""
$cleanArtist = ($cleanArtist -split ",")[0].Trim()

# Temporary store for plain lyrics fallback (we prefer synced if NetEase/Musixmatch has them)
$plainFallback = $null

# ------------------------------------------------------------
# 1. Try Lrclib first (Primary)
# ------------------------------------------------------------
try {
    $trackEsc = [uri]::EscapeDataString($cleanTrack)
    $artistEsc = [uri]::EscapeDataString($cleanArtist)
    $url = "https://lrclib.net/api/get?artist_name=$artistEsc&track_name=$trackEsc"
    
    # 5-second timeout to prevent hanging if Lrclib is offline
    $response = Invoke-RestMethod -Uri $url -Method Get -TimeoutSec 5
    if ($response) {
        if ($response.syncedLyrics) {
            $Output.synced = $true
            $Output.lyrics = $response.syncedLyrics
            $Output | ConvertTo-Json -Compress
            exit
        } elseif ($response.plainLyrics) {
            $plainFallback = $response.plainLyrics
        }
    }
} catch {
    # Proceed to NetEase if Lrclib fails
}


# ------------------------------------------------------------
# 2. Try NetEase Cloud Music (Secondary Fallback - Synced Only)
# ------------------------------------------------------------
try {
    $query = [uri]::EscapeDataString("$cleanArtist $cleanTrack")
    $searchUrl = "https://music.163.com/api/search/get/web?s=$query&type=1&limit=5"
    
    $searchResponse = Invoke-RestMethod -Uri $searchUrl -Method Get -TimeoutSec 5
    if ($searchResponse -and $searchResponse.result) {
        $resultObj = ConvertFrom-Json $searchResponse.result
        if ($resultObj.songs -and $resultObj.songs.Count -gt 0) {
            $songId = $resultObj.songs[0].id
            
            $lyricUrl = "https://music.163.com/api/song/lyric?os=pc&id=$songId&lv=-1&kv=-1&tv=-1"
            $lyricResponse = Invoke-RestMethod -Uri $lyricUrl -Method Get -TimeoutSec 5
            
            if ($lyricResponse -and $lyricResponse.lrc -and $lyricResponse.lrc.lyric) {
                $Output.synced = $true
                $Output.lyrics = $lyricResponse.lrc.lyric
                $Output | ConvertTo-Json -Compress
                exit
            }
        }
    }
} catch {
    # Proceed to Musixmatch if NetEase fails
}


# ------------------------------------------------------------
# 3. Musixmatch Fallback (Tertiary Fallback - Synced/Plain)
# ------------------------------------------------------------
try {
    $headers = @{
        "User-Agent" = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Musixmatch/0.19.4 Chrome/58.0.3029.110 Electron/1.7.6 Safari/537.36"
    }

    $session = New-Object Microsoft.PowerShell.Commands.WebRequestSession
    $cookie1 = New-Object System.Net.Cookie("AWSELB", "0", "/", "apic-desktop.musixmatch.com")
    $session.Cookies.Add($cookie1)
    $cookie2 = New-Object System.Net.Cookie("AWSELBCORS", "0", "/", "apic-desktop.musixmatch.com")
    $session.Cookies.Add($cookie2)

    # Use cached token file to avoid rate limiting
    $tokenFile = Join-Path $PSScriptRoot "musixmatch_token.txt"
    $userToken = $null

    if (Test-Path $tokenFile) {
        try {
            $userToken = (Get-Content -Path $tokenFile -Raw).Trim()
        } catch {}
    }

    if (-not $userToken) {
        $tokenUri = "https://apic-desktop.musixmatch.com/ws/1.1/token.get?app_id=web-desktop-app-v1.0&user_language=en"
        $tokenResponse = Invoke-RestMethod -Uri $tokenUri -Method Get -Headers $headers -WebSession $session
        $userToken = $tokenResponse.message.body.user_token
        if ($userToken) {
            $userToken | Out-File -FilePath $tokenFile -NoNewline -Encoding utf8
        }
    }

    if ($userToken) {
        $trackNameEsc = [uri]::EscapeDataString($cleanTrack)
        $artistNameEsc = [uri]::EscapeDataString($cleanArtist)
        $searchUri = "https://apic-desktop.musixmatch.com/ws/1.1/track.search?q_track=$trackNameEsc&q_artist=$artistNameEsc&page_size=1&usertoken=$userToken&app_id=web-desktop-app-v1.0"
        
        $searchResponse = Invoke-RestMethod -Uri $searchUri -Method Get -Headers $headers -WebSession $session
        
        # Handle expired token (401)
        if ($searchResponse.message.header.status_code -eq 401) {
            Remove-Item $tokenFile -ErrorAction SilentlyContinue
            $tokenUri = "https://apic-desktop.musixmatch.com/ws/1.1/token.get?app_id=web-desktop-app-v1.0&user_language=en"
            $tokenResponse = Invoke-RestMethod -Uri $tokenUri -Method Get -Headers $headers -WebSession $session
            $userToken = $tokenResponse.message.body.user_token
            if ($userToken) {
                $userToken | Out-File -FilePath $tokenFile -NoNewline -Encoding utf8
                $searchUri = "https://apic-desktop.musixmatch.com/ws/1.1/track.search?q_track=$trackNameEsc&q_artist=$artistNameEsc&page_size=1&usertoken=$userToken&app_id=web-desktop-app-v1.0"
                $searchResponse = Invoke-RestMethod -Uri $searchUri -Method Get -Headers $headers -WebSession $session
            }
        }

        $trackList = $searchResponse.message.body.track_list

        if ($trackList -and $trackList.Count -gt 0) {
            $track = $trackList[0].track
            $trackId = $track.track_id

            if ($track.has_subtitles -eq 1) {
                $subtitleUri = "https://apic-desktop.musixmatch.com/ws/1.1/track.subtitle.get?track_id=$trackId&subtitle_format=lrc&usertoken=$userToken&app_id=web-desktop-app-v1.0"
                $subResponse = Invoke-RestMethod -Uri $subtitleUri -Method Get -Headers $headers -WebSession $session
                $subtitleBody = $subResponse.message.body.subtitle.subtitle_body
                
                if ($subtitleBody) {
                    $Output.synced = $true
                    $Output.lyrics = $subtitleBody
                    $Output | ConvertTo-Json -Compress
                    exit
                }
            }
            elseif ($track.has_lyrics -eq 1 -and -not $plainFallback) {
                $lyricsUri = "https://apic-desktop.musixmatch.com/ws/1.1/track.lyrics.get?track_id=$trackId&usertoken=$userToken&app_id=web-desktop-app-v1.0"
                $lyricsResponse = Invoke-RestMethod -Uri $lyricsUri -Method Get -Headers $headers -WebSession $session
                $lyricsBody = $lyricsResponse.message.body.lyrics.lyrics_body
                
                if ($lyricsBody) {
                    # Strip copyright warning footer
                    $lyricsBody = $lyricsBody -replace "\*\*\*\*\*\ *[\s\S]*", ""
                    $plainFallback = $lyricsBody.Trim()
                }
            }
        }
    }
} catch {
    # Proceed to Lyrics.ovh if Musixmatch fails
}


# ------------------------------------------------------------
# 4. Try Lyrics.ovh (Quaternary Fallback - Plain Lyrics)
# ------------------------------------------------------------
try {
    if (-not $plainFallback) {
        $trackEsc = [uri]::EscapeDataString($cleanTrack)
        $artistEsc = [uri]::EscapeDataString($cleanArtist)
        $url = "https://api.lyrics.ovh/v1/$artistEsc/$trackEsc"
        
        $response = Invoke-RestMethod -Uri $url -Method Get -TimeoutSec 5
        if ($response -and $response.lyrics) {
            $plainFallback = $response.lyrics
        }
    }
} catch {
    # Fallback to default not found response
}

# ------------------------------------------------------------
# Return Plain Text Fallback if no synced lyrics were resolved
# ------------------------------------------------------------
if ($plainFallback) {
    $Output.synced = $false
    $Output.lyrics = $plainFallback
}

# Output the final result as JSON
$Output | ConvertTo-Json -Compress
