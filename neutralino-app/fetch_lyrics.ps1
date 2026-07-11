param(
    [string]$trackName,
    [string]$artistName
)

$Output = @{
    synced = $false
    lyrics = "Lyrics not found for this track."
}

# 1. Try Lrclib first on the backend (Bypasses browser CORS policy)
try {
    $trackEsc = [uri]::EscapeDataString($trackName)
    $artistEsc = [uri]::EscapeDataString($artistName)
    $url = "https://lrclib.net/api/get?artist_name=$artistEsc&track_name=$trackEsc"
    
    # Send request with a 5-second timeout to prevent hanging if Lrclib has service issues
    $response = Invoke-RestMethod -Uri $url -Method Get -TimeoutSec 5
    if ($response) {
        if ($response.syncedLyrics) {
            $Output.synced = $true
            $Output.lyrics = $response.syncedLyrics
            $Output | ConvertTo-Json -Compress
            exit
        } elseif ($response.plainLyrics) {
            $Output.synced = $false
            $Output.lyrics = $response.plainLyrics
            $Output | ConvertTo-Json -Compress
            exit
        }
    }
} catch {
    # If Lrclib fails (e.g. 504 Gateway Time-out), proceed to Musixmatch fallback
}

# 2. Musixmatch Fallback
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
        # Clean track name and artist name to strip suffixes/features
        $cleanTrack = $trackName -replace "\s*\((feat|with|featuring)\.?\s+[^)]+\)", ""
        $cleanTrack = $cleanTrack -replace "\s*\((Remastered|Deluxe|Expanded|Special|Anniversary)\s*[^)]*\)", ""
        $cleanTrack = $cleanTrack -replace "\s*-\s*(Remastered|Deluxe|Expanded|Special|Anniversary)\s*.*", ""
        $cleanTrack = $cleanTrack -replace "\s*\((Live|Acoustic|Radio Edit|Remix|Edit|Mix)\)", ""
        $cleanTrack = $cleanTrack.Trim()

        $cleanArtist = $artistName -replace "\s*(feat|with|featuring)\.?\s+.*", ""
        $cleanArtist = ($cleanArtist -split ",")[0].Trim()

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
                }
            }
            elseif ($track.has_lyrics -eq 1) {
                $lyricsUri = "https://apic-desktop.musixmatch.com/ws/1.1/track.lyrics.get?track_id=$trackId&usertoken=$userToken&app_id=web-desktop-app-v1.0"
                $lyricsResponse = Invoke-RestMethod -Uri $lyricsUri -Method Get -Headers $headers -WebSession $session
                $lyricsBody = $lyricsResponse.message.body.lyrics.lyrics_body
                
                if ($lyricsBody) {
                    # Strip copyright warning footer
                    $lyricsBody = $lyricsBody -replace "\*\*\*\*\*\ *[\s\S]*", ""
                    $Output.synced = $false
                    $Output.lyrics = $lyricsBody.Trim()
                }
            }
        }
    }
} catch {
    # Fallback to default not found response
}

# Output the final result as JSON
$Output | ConvertTo-Json -Compress
