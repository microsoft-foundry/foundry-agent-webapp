param([string]$Version, [string]$First, [string]$Second, [string]$Tag)
$sp = $PSScriptRoot
$token = az account get-access-token --resource https://ai.azure.com --query accessToken -o tsv
$endpoint = "https://proj-kisan.services.ai.azure.com/api/projects/proj-kisan"
$conv = (Invoke-WebRequest -Method Post -Uri "$endpoint/openai/v1/conversations" -Headers @{ Authorization = "Bearer $token" } -ContentType "application/json" -Body "{}" -UseBasicParsing).Content | ConvertFrom-Json
foreach ($q in @($First, $Second)) {
  $body = @{ agent_reference = @{ type = "agent_reference"; name = "Kisan-Orchestrator"; version = $Version }; conversation = $conv.id; input = $q; stream = $true } | ConvertTo-Json -Depth 6
  $bf = Join-Path $sp "body-$Tag.json"; [IO.File]::WriteAllText($bf, $body)
  $out = Join-Path $sp "stream-$Tag.txt"
  curl.exe -sS -N -X POST "$endpoint/openai/v1/responses" -H "Authorization: Bearer $token" -H "Content-Type: application/json" --data-binary "@$bf" --max-time 280 -o $out | Out-Null
  $ev = Get-Content $out -Encoding UTF8 | Where-Object { $_ -like 'data:*' } | ForEach-Object { try { ($_ -replace '^data: ','') | ConvertFrom-Json } catch {} }
  $msgs = ($ev | Where-Object { $_.type -eq 'response.output_item.done' -and $_.item.type -eq 'message' } | ForEach-Object {
    $t = (($_.item.content | ForEach-Object { $_.text }) -join ' ')
    "$($_.item.agent_reference.name)[$($t.Length) chars]" }) -join ' -> '
  $end = ($ev | Where-Object { $_.type -in 'response.completed','response.failed' }).type
  "[$Tag v$Version] '$q' => $msgs | $end"
}
