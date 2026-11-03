$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$smokeRoot = Join-Path $projectRoot '.work\hta-smoke'
New-Item -ItemType Directory -Path $smokeRoot -Force | Out-Null
$firstPath = Join-Path $smokeRoot '中文 空格#%&+文件.md'
$secondPath = Join-Path $smokeRoot '第二个文件.markdown'
$resultPath = Join-Path $smokeRoot 'result.json'
Set-Content -LiteralPath $firstPath -Encoding utf8 -Value "# 第一篇文档`r`n`r`n中文特殊路径打开成功。"
Set-Content -LiteralPath $secondPath -Encoding utf8 -Value "# 第二篇文档`r`n`r`n连续打开成功。"
if (Test-Path -LiteralPath $resultPath) { Remove-Item -LiteralPath $resultPath }
Copy-Item -LiteralPath (Join-Path $projectRoot '清阅 Markdown.exe') -Destination $smokeRoot -Force
$hta = Get-Content -LiteralPath (Join-Path $projectRoot 'reader.hta') -Raw -Encoding utf8
$hta = $hta.Replace('APPLICATIONNAME="清阅 Markdown"', 'APPLICATIONNAME="QingYueRuntimeSmoke"')
$fixture = @{ first = $firstPath; second = $secondPath; output = $resultPath } | ConvertTo-Json -Compress
$harness = @'
 var smokeFixture=FIXTURE_JSON,smokeChecks=[];
 function smokeAssert(ok,label){if(!ok)throw new Error(label);smokeChecks.push(label)}
 function finishSmoke(error){var fso=new ActiveXObject('Scripting.FileSystemObject'),output=fso.CreateTextFile(smokeFixture.output,true,true);output.Write(JSON.stringify({passed:!error,checks:smokeChecks,error:error?String(error.message||error):'',documentMode:document.documentMode}));output.Close();window.close()}
 try{
   smokeAssert(paper.innerText.indexOf('第一篇文档')>=0,'launcher query opens a real Chinese path with spaces and #%&+');
   load(smokeFixture.second);
   smokeAssert(paper.innerText.indexOf('连续打开成功')>=0&&filename.textContent==='第二个文件.markdown','second real file updates title and contents');
   var previous=paper.innerHTML;fileInput.onchange();
   smokeAssert(paper.innerHTML===previous,'cancel preserves the document');
   var dropped=new Blob(['# 拖放文档\n\nFileReader 实际读取成功。'],{type:'text/plain'});dropped.name='拖入文件.md';
   document.ondrop({preventDefault:function(){},dataTransfer:{files:[dropped],getData:function(){return ''}}});
   setTimeout(function(){try{smokeAssert(paper.innerText.indexOf('FileReader 实际读取成功')>=0&&filename.textContent==='拖入文件.md','drop handler reads a real Blob using the HTA FileReader');finishSmoke()}catch(e){finishSmoke(e)}},1200);
 }catch(e){finishSmoke(e)}
'@
$harness = $harness.Replace('FIXTURE_JSON', $fixture)
$hta = $hta.Replace('})();', $harness + "`r`n})();")
Set-Content -LiteralPath (Join-Path $smokeRoot 'reader.hta') -Encoding utf8 -Value $hta
Start-Process -FilePath (Join-Path $smokeRoot '清阅 Markdown.exe') -ArgumentList ('"' + $firstPath + '"')
$deadline = [DateTime]::UtcNow.AddSeconds(15)
while (!(Test-Path -LiteralPath $resultPath) -and [DateTime]::UtcNow -lt $deadline) { Start-Sleep -Milliseconds 200 }
if (!(Test-Path -LiteralPath $resultPath)) { throw 'HTA runtime did not produce a smoke-test result within 15 seconds.' }
$result = Get-Content -LiteralPath $resultPath -Raw -Encoding unicode | ConvertFrom-Json
$result | ConvertTo-Json -Depth 3
if (!$result.passed) { throw $result.error }
