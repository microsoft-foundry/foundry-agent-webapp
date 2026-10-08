param([string]$Question, [string]$Version = "")
$sp = $PSScriptRoot
$token = az account get-access-token --resource https://ai.azure.com --query accessToken -o tsv
$endpoint = "https://proj-kisan.services.ai.azure.com/api/projects/proj-kisan"
$conv = (Invoke-WebRequest -Method Post -Uri "$endpoint/openai/v1/conversations" -Headers @{ Authorization = "Bearer $token" } -ContentType "application/json" -Body "{}" -UseBasicParsing).Content | ConvertFrom-Json
$ref = @{ type = "agent_reference"; name = "Kisan-Orchestrator" }
if ($Version) { $ref.version = $Version }
$body = @{ agent_reference = $ref; conversation = $conv.id; input = $Question; stream = $true } | ConvertTo-Json -Depth 6
$bodyFile = Join-Path $sp "body.json"; [IO.File]::WriteAllText($bodyFile, $body)
$out = Join-Path $sp "stream-last.txt"
curl.exe -sS -N -X POST "$endpoint/openai/v1/responses" -H "Authorization: Bearer $token" -H "Content-Type: application/json" --data-binary "@$bodyFile" --max-time 280 -o $out -w "HTTP %{http_code}`n"
$events = Get-Content $out -Encoding UTF8 | Where-Object { $_ -like 'data:*' } | ForEach-Object { try { ($_ -replace '^data: ','') | ConvertFrom-Json } catch {} }
$deltaText = ($events | Where-Object { $_.type -eq 'response.output_text.delta' } | ForEach-Object { $_.delta }) -join ''
foreach ($e in $events) {
  if ($e.type -eq 'response.output_item.done') {
    $it = $e.item
    "step done: type={0} agent={1} action={2} status={3}" -f $it.type, $it.agent_reference.name, $it.action_id, $it.status
  }
  if ($e.type -in 'response.failed','response.completed') {
    "FINAL: $($e.type) " + ($e.response.error | ConvertTo-Json -Compress)
  }
}
"===== TEXT STREAMED TO USER ====="
$deltaText
