param(
    [Parameter(Mandatory=$true)][string]$EncodedArgs
)

# Force UTF-8
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}
$OutputEncoding = [System.Text.Encoding]::UTF8

$Output = @{
    synced = $false
    lyrics = "Lyrics not found for this track."
}

# --- SECURE ARG DECODING ---
$trackName = ""
$artistName = ""
try {
    $jsonBytes = [System.Convert]::FromBase64String($EncodedArgs)
    $jsonStr = [System.Text.Encoding]::UTF8.GetString($jsonBytes)
    if ($jsonStr.Length -gt 1000) { throw "Args too long" }
    $decoded = $jsonStr | ConvertFrom-Json
    $trackName = $decoded.track.ToString().Substring(0, [Math]::Min(200, $decoded.track.ToString().Length)).Trim()
    $artistName = $decoded.artist.ToString().Substring(0, [Math]::Min(200, $decoded.artist.ToString().Length)).Trim()
    
    [string[]]$providers = @()
    if ($decoded.providers) {
        $providers = [string[]]($decoded.providers)
    } else {
        $providers = @("lrclib", "netease", "musixmatch", "lyricsovh")
    }
} catch {
    $Output | ConvertTo-Json -Compress
    exit
}

# Prepare search titles - improved cleaning, only strip suffixes at end
$originalTrack = $trackName.Trim()

$cleanTrack = $trackName
# Only strip " - Remastered/Deluxe/etc" if at END of string, not any " - "
$cleanTrack = $cleanTrack -replace "\s*-\s*(Remastered|Deluxe|Expanded|Special|Anniversary|Live|Acoustic|Radio Edit|Remix|Edit|Mix|Single Version|Mono|Stereo).*?$", ""
$cleanTrack = $cleanTrack -replace "\s*\((feat|with|featuring)\.?\s+[^)]+\)\s*$", ""
$cleanTrack = $cleanTrack -replace "\s*\((Remastered|Deluxe|Expanded|Special|Anniversary|Live|Acoustic|Radio Edit|Remix|Edit|Mix|Single Version|Mono|Stereo)[^)]*\)\s*$", ""
$cleanTrack = $cleanTrack.Trim()
if (-not $cleanTrack) { $cleanTrack = $originalTrack }

$cleanArtist = $artistName -replace "\s*(feat|with|featuring)\.?\s+.*$", ""
$cleanArtist = ($cleanArtist -split ",")[0].Trim()

$plainFallback = $null
$commonHeaders = @{ "User-Agent" = "Spotify-Lyrics-Overlay/2.0 (Neutralinojs)" }

function Get-LrclibLyrics([string]$track, [string]$artist) {
    try {
        $trackEsc = [uri]::EscapeDataString($track)
        $artistEsc = [uri]::EscapeDataString($artist)
        $url = "https://lrclib.net/api/get?artist_name=$artistEsc&track_name=$trackEsc"
        $response = Invoke-RestMethod -Uri $url -Method Get -TimeoutSec 5 -Headers $commonHeaders -ErrorAction Stop
        return $response
    } catch { return $null }
}

function Get-NetEaseLyrics([string]$track, [string]$artist) {
    try {
        $query = [uri]::EscapeDataString("$artist $track")
        $searchUrl = "https://music.163.com/api/search/get/web?s=$query&type=1&limit=5"
        $searchResponse = Invoke-RestMethod -Uri $searchUrl -Method Get -TimeoutSec 5 -Headers $commonHeaders -ErrorAction Stop
        if ($searchResponse -and $searchResponse.result) {
            $resultObj = $searchResponse.result | ConvertFrom-Json -ErrorAction Stop
            if ($resultObj.songs -and $resultObj.songs.Count -gt 0) {
                $songId = $resultObj.songs[0].id
                $lyricUrl = "https://music.163.com/api/song/lyric?os=pc&id=$songId&lv=-1&kv=-1&tv=-1"
                $lyricResponse = Invoke-RestMethod -Uri $lyricUrl -Method Get -TimeoutSec 5 -Headers $commonHeaders -ErrorAction Stop
                if ($lyricResponse -and $lyricResponse.lrc -and $lyricResponse.lrc.lyric -and $lyricResponse.lrc.lyric.Length -lt 100000) {
                    return $lyricResponse.lrc.lyric
                }
            }
        }
    } catch {}
    return $null
}

function Get-MusixmatchLyrics([string]$track, [string]$artist) {
    try {
        $headers = @{ "User-Agent" = "Spotify-Lyrics-Overlay/2.0" }
        $session = New-Object Microsoft.PowerShell.Commands.WebRequestSession
        
        # Secure token path in APPDATA, not next to exe
        $appData = $env:APPDATA
        if (-not $appData) { $appData = $PSScriptRoot }
        $tokenDir = Join-Path $appData "SpotifyLyricsOverlay"
        if (-not (Test-Path $tokenDir)) { New-Item -ItemType Directory -Path $tokenDir -Force | Out-Null }
        $tokenFile = Join-Path $tokenDir "musixmatch_token.txt"

        $userToken = $null
        if (Test-Path $tokenFile) {
            try { 
                $userToken = (Get-Content -Path $tokenFile -Raw -ErrorAction Stop).Trim()
                if ($userToken.Length -gt 500) { $userToken = $null }
            } catch {}
        }

        if (-not $userToken) {
            $tokenUri = "https://apic-desktop.musixmatch.com/ws/1.1/token.get?app_id=web-desktop-app-v1.0&user_language=en"
            $tokenResponse = Invoke-RestMethod -Uri $tokenUri -Method Get -Headers $headers -WebSession $session -TimeoutSec 5 -ErrorAction Stop
            $userToken = $tokenResponse.message.body.user_token
            if ($userToken -and $userToken.Length -lt 500) {
                try { $userToken | Out-File -FilePath $tokenFile -NoNewline -Encoding utf8 -Force } catch {}
            }
        }

        if ($userToken) {
            $trackEsc = [uri]::EscapeDataString($track)
            $artistEsc = [uri]::EscapeDataString($artist)
            $searchUri = "https://apic-desktop.musixmatch.com/ws/1.1/track.search?q_track=$trackEsc&q_artist=$artistEsc&page_size=1&usertoken=$userToken&app_id=web-desktop-app-v1.0"
            $searchResponse = Invoke-RestMethod -Uri $searchUri -Method Get -Headers $headers -WebSession $session -TimeoutSec 5 -ErrorAction Stop
            
            if ($searchResponse.message.header.status_code -eq 401) {
                Remove-Item $tokenFile -ErrorAction SilentlyContinue
                return $null
            }

            $trackList = $searchResponse.message.body.track_list
            if ($trackList -and $trackList.Count -gt 0) {
                $foundTrack = $trackList[0].track
                $trackId = $foundTrack.track_id
                if ($foundTrack.has_subtitles -eq 1) {
                    $subtitleUri = "https://apic-desktop.musixmatch.com/ws/1.1/track.subtitle.get?track_id=$trackId&subtitle_format=lrc&usertoken=$userToken&app_id=web-desktop-app-v1.0"
                    $subResponse = Invoke-RestMethod -Uri $subtitleUri -Method Get -Headers $headers -WebSession $session -TimeoutSec 5 -ErrorAction Stop
                    $body = $subResponse.message.body.subtitle.subtitle_body
                    if ($body -and $body.Length -lt 100000) {
                        return @{ synced = $true; lyrics = $body }
                    }
                } elseif ($foundTrack.has_lyrics -eq 1) {
                    $lyricsUri = "https://apic-desktop.musixmatch.com/ws/1.1/track.lyrics.get?track_id=$trackId&usertoken=$userToken&app_id=web-desktop-app-v1.0"
                    $lyricsResponse = Invoke-RestMethod -Uri $lyricsUri -Method Get -Headers $headers -WebSession $session -TimeoutSec 5 -ErrorAction Stop
                    $body = $lyricsResponse.message.body.lyrics.lyrics_body
                    if ($body -and $body.Length -lt 100000) {
                        $body = $body -replace "\*\*\*\*\*\ *[\s\S]*", ""
                        return @{ synced = $false; lyrics = $body.Trim() }
                    }
                }
            }
        }
    } catch {}
    return $null
}

function Get-LyricsOvh([string]$track, [string]$artist) {
    try {
        $trackEsc = [uri]::EscapeDataString($track)
        $artistEsc = [uri]::EscapeDataString($artist)
        $url = "https://api.lyrics.ovh/v1/$artistEsc/$trackEsc"
        $response = Invoke-RestMethod -Uri $url -Method Get -TimeoutSec 5 -Headers $commonHeaders -ErrorAction Stop
        if ($response -and $response.lyrics -and $response.lyrics.Length -lt 100000) {
            return $response.lyrics
        }
    } catch {}
    return $null
}

# --- Split providers into Tier 1 and Tier 2 based on user priorities ---
$tier1 = @()
$tier2 = @()
foreach ($p in $providers) {
    if ($p -eq "lrclib" -or $p -eq "netease") {
        $tier1 += $p
    } elseif ($p -eq "musixmatch" -or $p -eq "lyricsovh") {
        $tier2 += $p
    }
}

# --- Parallel Scraper Helper ---
function Invoke-ScrapersInParallel {
    param(
        [string[]]$TargetProviders,
        [string]$Track,
        [string]$Artist,
        [int]$TimeoutMs = 2000
    )
    
    $instances = @()
    $pool = [runspacefactory]::CreateRunspacePool(1, $TargetProviders.Length)
    $pool.Open()

    $headersDef = "`$commonHeaders = @{ 'User-Agent' = 'Spotify-Lyrics-Overlay/2.0 (Neutralinojs)' }"

    foreach ($p in $TargetProviders) {
        $funcDef = ""
        $execCall = ""
        
        if ($p -eq "lrclib") {
            $funcDef = "function Get-LrclibLyrics { " + $Function:Get-LrclibLyrics.ToString() + " }"
            $execCall = "Get-LrclibLyrics `"$Track`" `"$Artist`""
        } elseif ($p -eq "netease") {
            $funcDef = "function Get-NetEaseLyrics { " + $Function:Get-NetEaseLyrics.ToString() + " }"
            $execCall = "Get-NetEaseLyrics `"$Track`" `"$Artist`""
        } elseif ($p -eq "musixmatch") {
            $funcDef = "function Get-MusixmatchLyrics { " + $Function:Get-MusixmatchLyrics.ToString() + " }"
            $execCall = "Get-MusixmatchLyrics `"$Track`" `"$Artist`""
        } elseif ($p -eq "lyricsovh") {
            $funcDef = "function Get-LyricsOvh { " + $Function:Get-LyricsOvh.ToString() + " }"
            $execCall = "Get-LyricsOvh `"$Track`" `"$Artist`""
        }

        if ($funcDef -eq "") { continue }

        $script = @"
$headersDef
$funcDef
$execCall
"@
        
        $powershell = [powershell]::Create().AddScript($script)
        $powershell.RunspacePool = $pool
        $handle = $powershell.BeginInvoke()
        $instances += [PSCustomObject]@{
            Provider = $p
            PowerShell = $powershell
            Handle = $handle
        }
    }

    # Wait for completion or timeout
    $elapsed = 0
    $interval = 50
    while ($elapsed -lt $TimeoutMs) {
        $completedCount = 0
        foreach ($inst in $instances) {
            if ($inst.Handle.IsCompleted) {
                $completedCount++
            }
        }
        if ($completedCount -eq $instances.Length) { break }
        Start-Sleep -Milliseconds $interval
        $elapsed += $interval
    }

    # Gather results
    $results = @{}
    foreach ($inst in $instances) {
        if ($inst.Handle.IsCompleted) {
            try {
                $res = $inst.PowerShell.EndInvoke($inst.Handle)
                if ($res) {
                    $results[$inst.Provider] = $res[0]
                }
            } catch {}
        } else {
            try { $inst.PowerShell.Stop() } catch {}
        }
        $inst.PowerShell.Dispose()
    }
    $pool.Close()
    $pool.Dispose()

    return $results
}

# --- Lyrics Preference Helper ---
function Select-BestLyrics {
    param(
        [hashtable]$Results,
        [string[]]$PriorityList
    )
    
    foreach ($p in $PriorityList) {
        if (-not $Results.ContainsKey($p)) { continue }
        $res = $Results[$p]
        if ($p -eq "lrclib" -and $res -and $res.syncedLyrics) {
            return @{ synced = $true; lyrics = $res.syncedLyrics }
        } elseif ($p -eq "netease" -and $res) {
            return @{ synced = $true; lyrics = $res }
        } elseif ($p -eq "musixmatch" -and $res -and $res.synced) {
            return @{ synced = $true; lyrics = $res.lyrics }
        }
    }
    
    foreach ($p in $PriorityList) {
        if (-not $Results.ContainsKey($p)) { continue }
        $res = $Results[$p]
        if ($p -eq "lrclib" -and $res -and $res.plainLyrics) {
            return @{ synced = $false; lyrics = $res.plainLyrics }
        } elseif ($p -eq "musixmatch" -and $res -and -not $res.synced) {
            return @{ synced = $false; lyrics = $res.lyrics }
        } elseif ($p -eq "lyricsovh" -and $res) {
            return @{ synced = $false; lyrics = $res }
        }
    }
    
    return $null
}

# --- PASS 1: Exact Version Match ---
$bestResult = $null
if ($originalTrack -ne $cleanTrack) {
    if ($tier1.Length -gt 0) {
        $results1 = Invoke-ScrapersInParallel $tier1 $originalTrack $cleanArtist 2000
        $bestResult = Select-BestLyrics $results1 $tier1
    }
    
    if (-not $bestResult -or -not $bestResult.synced) {
        if ($tier2.Length -gt 0) {
            $results2 = Invoke-ScrapersInParallel $tier2 $originalTrack $cleanArtist 2000
            $bestResult2 = Select-BestLyrics $results2 $tier2
            if ($bestResult2 -and ($bestResult2.synced -or -not $bestResult)) {
                $bestResult = $bestResult2
            }
        }
    }
}

if ($bestResult -and $bestResult.synced) {
    $Output.synced = $true
    $Output.lyrics = $bestResult.lyrics
    $Output | ConvertTo-Json -Compress
    exit
}

# --- PASS 2: Main Title Match ---
$plainFallback = $null
if ($bestResult -and -not $bestResult.synced) {
    $plainFallback = $bestResult.lyrics
}

if ($tier1.Length -gt 0) {
    $results1 = Invoke-ScrapersInParallel $tier1 $cleanTrack $cleanArtist 2000
    $cleanBest1 = Select-BestLyrics $results1 $tier1
    if ($cleanBest1 -and $cleanBest1.synced) {
        $Output.synced = $true
        $Output.lyrics = $cleanBest1.lyrics
        $Output | ConvertTo-Json -Compress
        exit
    } elseif ($cleanBest1 -and -not $plainFallback) {
        $plainFallback = $cleanBest1.lyrics
    }
}

if ($tier2.Length -gt 0) {
    $results2 = Invoke-ScrapersInParallel $tier2 $cleanTrack $cleanArtist 2000
    $cleanBest2 = Select-BestLyrics $results2 $tier2
    if ($cleanBest2 -and $cleanBest2.synced) {
        $Output.synced = $true
        $Output.lyrics = $cleanBest2.lyrics
        $Output | ConvertTo-Json -Compress
        exit
    } elseif ($cleanBest2 -and -not $plainFallback) {
        $plainFallback = $cleanBest2.lyrics
    }
}

if ($plainFallback) {
    $Output.synced = $false
    $Output.lyrics = $plainFallback
}

$Output | ConvertTo-Json -Compress
