param(
    [string]$trackName,
    [string]$artistName
)

$Output = @{
    synced = $false
    lyrics = "Lyrics not found for this track."
}

$headers = @{
    "User-Agent" = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Musixmatch/0.19.4 Chrome/58.0.3029.110 Electron/1.7.6 Safari/537.36"
}

# Setup WebSession for cookies
$session = New-Object Microsoft.PowerShell.Commands.WebRequestSession
$cookie1 = New-Object System.Net.Cookie("AWSELB", "0", "/", "apic-desktop.musixmatch.com")
$session.Cookies.Add($cookie1)
$cookie2 = New-Object System.Net.Cookie("AWSELBCORS", "0", "/", "apic-desktop.musixmatch.com")
$session.Cookies.Add($cookie2)

# Cache token in a local text file to avoid rate limits
$tokenFile = Join-Path $PSScriptRoot "musixmatch_token.txt"
$userToken = $null

if (Test-Path $tokenFile) {
    try {
        $userToken = (Get-Content -Path $tokenFile -Raw).Trim()
    } catch {}
}

# If no token is cached, fetch one dynamically
if (-not $userToken) {
    try {
        $tokenUri = "https://apic-desktop.musixmatch.com/ws/1.1/token.get?app_id=web-desktop-app-v1.0&user_language=en"
        $tokenResponse = Invoke-RestMethod -Uri $tokenUri -Method Get -Headers $headers -WebSession $session
        $userToken = $tokenResponse.message.body.user_token
        if ($userToken) {
            $userToken | Out-File -FilePath $tokenFile -NoNewline -Encoding utf8
        }
    } catch {}
}

if ($userToken) {
    try {
        # Clean track name and artist name to strip suffixes/features and improve Musixmatch search matching
        $cleanTrack = $trackName -replace "\s*\((feat|with|featuring)\.?\s+[^)]+\)", ""
        $cleanTrack = $cleanTrack -replace "\s*\((Remastered|Deluxe|Expanded|Special|Anniversary)\s*[^)]*\)", ""
        $cleanTrack = $cleanTrack -replace "\s*-\s*(Remastered|Deluxe|Expanded|Special|Anniversary)\s*.*", ""
        $cleanTrack = $cleanTrack -replace "\s*\((Live|Acoustic|Radio Edit|Remix|Edit|Mix)\)", ""
        $cleanTrack = $cleanTrack.Trim()

        $cleanArtist = $artistName -replace "\s*(feat|with|featuring)\.?\s+.*", ""
        $cleanArtist = ($cleanArtist -split ",")[0].Trim()

        # 1. Search for the track on Musixmatch using cleaned queries
        $trackNameEsc = [uri]::EscapeDataString($cleanTrack)
        $artistNameEsc = [uri]::EscapeDataString($cleanArtist)
        $searchUri = "https://apic-desktop.musixmatch.com/ws/1.1/track.search?q_track=$trackNameEsc&q_artist=$artistNameEsc&page_size=1&usertoken=$userToken&app_id=web-desktop-app-v1.0"
        
        $searchResponse = Invoke-RestMethod -Uri $searchUri -Method Get -Headers $headers -WebSession $session
        
        # If the search API returns 401 (token expired/invalid), wipe the cache and try once more
        if ($searchResponse.message.header.status_code -eq 401) {
            Remove-Item $tokenFile -ErrorAction SilentlyContinue
            
            # Re-generate token
            $tokenUri = "https://apic-desktop.musixmatch.com/ws/1.1/token.get?app_id=web-desktop-app-v1.0&user_language=en"
            $tokenResponse = Invoke-RestMethod -Uri $tokenUri -Method Get -Headers $headers -WebSession $session
            $userToken = $tokenResponse.message.body.user_token
            if ($userToken) {
                $userToken | Out-File -FilePath $tokenFile -NoNewline -Encoding utf8
                # Re-search
                $searchUri = "https://apic-desktop.musixmatch.com/ws/1.1/track.search?q_track=$trackNameEsc&q_artist=$artistNameEsc&page_size=1&usertoken=$userToken&app_id=web-desktop-app-v1.0"
                $searchResponse = Invoke-RestMethod -Uri $searchUri -Method Get -Headers $headers -WebSession $session
            }
        }

        $trackList = $searchResponse.message.body.track_list

        if ($trackList -and $trackList.Count -gt 0) {
            $track = $trackList[0].track
            $trackId = $track.track_id

            # 2. If synced subtitles (LRC format) are available, fetch them
            if ($track.has_subtitles -eq 1) {
                $subtitleUri = "https://apic-desktop.musixmatch.com/ws/1.1/track.subtitle.get?track_id=$trackId&subtitle_format=lrc&usertoken=$userToken&app_id=web-desktop-app-v1.0"
                $subResponse = Invoke-RestMethod -Uri $subtitleUri -Method Get -Headers $headers -WebSession $session
                $subtitleBody = $subResponse.message.body.subtitle.subtitle_body
                
                if ($subtitleBody) {
                    $Output.synced = $true
                    $Output.lyrics = $subtitleBody
                }
            }
            # 3. If only plain lyrics are available, fetch them
            elseif ($track.has_lyrics -eq 1) {
                $lyricsUri = "https://apic-desktop.musixmatch.com/ws/1.1/track.lyrics.get?track_id=$trackId&usertoken=$userToken&app_id=web-desktop-app-v1.0"
                $lyricsResponse = Invoke-RestMethod -Uri $lyricsUri -Method Get -Headers $headers -WebSession $session
                $lyricsBody = $lyricsResponse.message.body.lyrics.lyrics_body
                
                if ($lyricsBody) {
                    # Strip the copyright warning footer common in Musixmatch API responses
                    $lyricsBody = $lyricsBody -replace "\*\*\*\*\*\*\*[\s\S]*", ""
                    $Output.synced = $false
                    $Output.lyrics = $lyricsBody.Trim()
                }
            }
        }
    } catch {
        # Fallback to default not found response
    }
}

# Output the result as JSON
$Output | ConvertTo-Json -Compress
