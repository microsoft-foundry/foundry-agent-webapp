param([string[]]$Questions, [string]$Version = "20")
$sp = $PSScriptRoot
$endpoint = "https://proj-kisan.services.ai.azure.com/api/projects/proj-kisan"
$i = 0
foreach ($q in $Questions) {
  $i++
  $token = az account get-access-token --resource https://ai.azure.com --query accessToken -o tsv
  $conv = (Invoke-WebRequest -Method Post -Uri "$endpoint/openai/v1/conversations" -Headers @{ Authorization = "Bearer $token" } -ContentType "application/json" -Body "{}" -UseBasicParsing).Content | ConvertFrom-Json
  $body = @{ agent_reference = @{ type = "agent_reference"; name = "Kisan-Orchestrator"; version = $Version }; conversation = $conv.id; input = $q; stream = $true } | ConvertTo-Json -Depth 6
  $bf = Join-Path $sp "body-v20.json"; [IO.File]::WriteAllText($bf, $body)
  $out = Join-Path $sp "stream-v20-$i.txt"
  curl.exe -sS -N -X POST "$endpoint/openai/v1/responses" -H "Authorization: Bearer $token" -H "Content-Type: application/json" --data-binary "@$bf" --max-time 280 -o $out | Out-Null
  $ev = Get-Content $out -Encoding UTF8 | Where-Object { $_ -like 'data:*' } | ForEach-Object { try { ($_ -replace '^data: ','') | ConvertFrom-Json } catch {} }
  $actions = ($ev | Where-Object { $_.type -eq 'response.output_item.done' -and $_.item.type -eq 'workflow_action' } | ForEach-Object { $_.item.action_id })
  $retried = ($actions | Where-Object { $_ -like '*_retry' }) -join ','
  $final = ($ev | Where-Object { $_.type -eq 'response.output_item.done' -and $_.item.type -eq 'message' -and $_.item.agent_reference.name -eq 'Kisan-Orchestrator' } | Select-Object -Last 1).item.content[0].text
  $end = ($ev | Where-Object { $_.type -in 'response.completed','response.failed' }).type
  $preview = if ($final) { ($final.Substring(0, [Math]::Min(90, $final.Length)) -replace "`n",' ') } else { '<NO FINAL MESSAGE>' }
  "{0,2}. {1,-45} | {2,-18} | retry={3,-16} | {4} chars | {5}" -f $i, $q.Substring(0,[Math]::Min(45,$q.Length)), $end, ($(if ($retried) { $retried } else { '-' })), $(if ($final) { $final.Length } else { 0 }), $preview
}
