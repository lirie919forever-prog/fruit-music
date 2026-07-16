param(
  [string]$Url = 'http://localhost:4176',
  [int]$Port = 9223,
  [int]$WaitSeconds = 15,
  [string]$OutputPath = 'C:\Users\louis\fruit-music\cdp-metrics.json'
)

$ErrorActionPreference = 'Stop'

function Get-BrowserPath {
  $candidates = @(
    'C:\Program Files\Google\Chrome\Application\chrome.exe',
    'C:\Program Files (x86)\Google\Chrome\Application\chrome.exe',
    'C:\Program Files\Microsoft\Edge\Application\msedge.exe',
    'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
  )

  foreach ($candidate in $candidates) {
    if (Test-Path $candidate) {
      return $candidate
    }
  }

  throw 'No Chrome or Edge executable found.'
}

function Receive-WebSocketMessage {
  param([System.Net.WebSockets.ClientWebSocket]$Socket)

  $buffer = New-Object byte[] 65536
  $segment = [System.ArraySegment[byte]]::new($buffer)
  $builder = New-Object System.Text.StringBuilder

  do {
    $result = $Socket.ReceiveAsync($segment, [System.Threading.CancellationToken]::None).GetAwaiter().GetResult()
    if ($result.MessageType -eq [System.Net.WebSockets.WebSocketMessageType]::Close) {
      throw 'WebSocket closed unexpectedly.'
    }
    [void]$builder.Append([System.Text.Encoding]::UTF8.GetString($buffer, 0, $result.Count))
  } while (-not $result.EndOfMessage)

  return $builder.ToString()
}

$script:MessageId = 0
function Invoke-Cdp {
  param(
    [System.Net.WebSockets.ClientWebSocket]$Socket,
    [string]$Method,
    [hashtable]$Params = @{}
  )

  $script:MessageId += 1
  $id = $script:MessageId
  $payload = @{ id = $id; method = $Method; params = $Params } | ConvertTo-Json -Compress -Depth 20
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($payload)
  $segment = [System.ArraySegment[byte]]::new($bytes)
  $Socket.SendAsync($segment, [System.Net.WebSockets.WebSocketMessageType]::Text, $true, [System.Threading.CancellationToken]::None).GetAwaiter().GetResult()

  while ($true) {
    $message = Receive-WebSocketMessage -Socket $Socket
    $json = $message | ConvertFrom-Json
    if ($null -ne $json.id -and [int]$json.id -eq $id) {
      return $json
    }
  }
}

$browserPath = Get-BrowserPath
$profilePath = Join-Path $env:TEMP ("cdp-profile-" + [guid]::NewGuid().ToString())
New-Item -ItemType Directory -Path $profilePath -Force | Out-Null

$browser = Start-Process -FilePath $browserPath -ArgumentList @(
  '--headless=new',
  '--disable-gpu',
  '--no-sandbox',
  "--remote-debugging-port=$Port",
  "--user-data-dir=$profilePath",
  'about:blank'
) -PassThru

try {
  $version = $null
  for ($i = 0; $i -lt 100 -and -not $version; $i++) {
    try {
      $version = Invoke-RestMethod -Uri ("http://127.0.0.1:{0}/json/version" -f $Port) -TimeoutSec 2
    } catch {
      Start-Sleep -Milliseconds 200
    }
  }

  if (-not $version) {
    throw 'CDP endpoint did not become available.'
  }

  $target = $null
  for ($i = 0; $i -lt 50 -and -not $target; $i++) {
    $targets = Invoke-RestMethod -Uri ("http://127.0.0.1:{0}/json/list" -f $Port) -TimeoutSec 2
    $target = $targets | Where-Object { $_.type -eq 'page' } | Select-Object -First 1
    if (-not $target) {
      Start-Sleep -Milliseconds 200
    }
  }

  if (-not $target) {
    throw 'No page target available from CDP.'
  }

  $socket = [System.Net.WebSockets.ClientWebSocket]::new()
  $socket.ConnectAsync([Uri]$target.webSocketDebuggerUrl, [System.Threading.CancellationToken]::None).GetAwaiter().GetResult()

  try {
    Invoke-Cdp -Socket $socket -Method 'Page.enable' | Out-Null
    Invoke-Cdp -Socket $socket -Method 'Runtime.enable' | Out-Null
    Invoke-Cdp -Socket $socket -Method 'Network.enable' | Out-Null
    Invoke-Cdp -Socket $socket -Method 'Network.setCacheDisabled' -Params @{ cacheDisabled = $true } | Out-Null
    Invoke-Cdp -Socket $socket -Method 'Emulation.setDeviceMetricsOverride' -Params @{
      width = 412
      height = 915
      deviceScaleFactor = 2.625
      mobile = $true
    } | Out-Null
    Invoke-Cdp -Socket $socket -Method 'Emulation.setUserAgentOverride' -Params @{
      userAgent = 'Mozilla/5.0 (Linux; Android 11; moto g power (2022)) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Mobile Safari/537.36'
      platform = 'Android'
    } | Out-Null
    Invoke-Cdp -Socket $socket -Method 'Emulation.setCPUThrottlingRate' -Params @{ rate = 4 } | Out-Null
    Invoke-Cdp -Socket $socket -Method 'Network.emulateNetworkConditions' -Params @{
      offline = $false
      latency = 150
      downloadThroughput = 209664
      uploadThroughput = 96000
      connectionType = 'cellular4g'
    } | Out-Null

    $observerSetup = @"
(() => {
  window.__perfMetrics = { lcp: 0, lcpSize: 0, lcpTag: '', lcpText: '', lcpUrl: '', cls: 0, longTasks: [] };
  new PerformanceObserver((entryList) => {
    const entries = entryList.getEntries();
    const last = entries[entries.length - 1];
    if (last) {
      window.__perfMetrics.lcp = last.startTime;
      window.__perfMetrics.lcpSize = last.size || 0;
      window.__perfMetrics.lcpTag = last.element?.tagName || '';
      window.__perfMetrics.lcpText = (last.element?.textContent || '').trim().slice(0, 120);
      window.__perfMetrics.lcpUrl = last.url || '';
    }
  }).observe({ type: 'largest-contentful-paint', buffered: true });

  new PerformanceObserver((entryList) => {
    for (const entry of entryList.getEntries()) {
      if (!entry.hadRecentInput) {
        window.__perfMetrics.cls += entry.value;
      }
    }
  }).observe({ type: 'layout-shift', buffered: true });

  new PerformanceObserver((entryList) => {
    for (const entry of entryList.getEntries()) {
      window.__perfMetrics.longTasks.push(entry.duration);
    }
  }).observe({ type: 'longtask', buffered: true });
})();
"@

    Invoke-Cdp -Socket $socket -Method 'Page.addScriptToEvaluateOnNewDocument' -Params @{ source = $observerSetup } | Out-Null
    Invoke-Cdp -Socket $socket -Method 'Page.navigate' -Params @{ url = $Url } | Out-Null
    Start-Sleep -Seconds $WaitSeconds

    $expression = @"
(() => {
  const nav = performance.getEntriesByType('navigation')[0];
  const fcp = performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? 0;
  const longTasks = window.__perfMetrics?.longTasks ?? [];
  const tbt = longTasks.reduce((sum, duration) => sum + Math.max(0, duration - 50), 0);
  return {
    url: location.href,
    fcp,
    lcp: window.__perfMetrics?.lcp ?? 0,
    lcpSize: window.__perfMetrics?.lcpSize ?? 0,
    lcpTag: window.__perfMetrics?.lcpTag ?? '',
    lcpText: window.__perfMetrics?.lcpText ?? '',
    lcpUrl: window.__perfMetrics?.lcpUrl ?? '',
    cls: window.__perfMetrics?.cls ?? 0,
    tbt,
    longTaskCount: longTasks.length,
    domContentLoaded: nav?.domContentLoadedEventEnd ?? 0,
    load: nav?.loadEventEnd ?? 0
  };
})()
"@

    $result = Invoke-Cdp -Socket $socket -Method 'Runtime.evaluate' -Params @{
      expression = $expression
      returnByValue = $true
      awaitPromise = $true
    }

    if ($result.result.result.type -eq 'object' -and $null -ne $result.result.result.value) {
      $metrics = $result.result.result.value
      $metrics | ConvertTo-Json -Depth 20 | Set-Content -Path $OutputPath -Encoding UTF8
      $metrics | ConvertTo-Json -Compress -Depth 20
    } else {
      throw ('Unexpected Runtime.evaluate response: ' + ($result | ConvertTo-Json -Depth 20))
    }
  }
  finally {
    if ($socket.State -eq [System.Net.WebSockets.WebSocketState]::Open) {
      $socket.CloseAsync([System.Net.WebSockets.WebSocketCloseStatus]::NormalClosure, 'done', [System.Threading.CancellationToken]::None).GetAwaiter().GetResult()
    }
    $socket.Dispose()
  }
}
finally {
  if ($browser -and -not $browser.HasExited) {
    Stop-Process -Id $browser.Id -Force
  }
  Remove-Item -Path $profilePath -Recurse -Force -ErrorAction SilentlyContinue
}
