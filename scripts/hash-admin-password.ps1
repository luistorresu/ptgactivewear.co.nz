param(
  [ValidateRange(100000, 100000)]
  [int]$Iterations = 100000
)

$ErrorActionPreference = 'Stop'

function ConvertTo-Base64Url([byte[]]$Bytes) {
  return [Convert]::ToBase64String($Bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
}

function Read-PlainText([Security.SecureString]$SecureValue) {
  $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($SecureValue)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
}

$first = Read-Host 'New admin password' -AsSecureString
$second = Read-Host 'Confirm admin password' -AsSecureString
$password = Read-PlainText $first
$confirmation = Read-PlainText $second

try {
  if ($password.Length -lt 14) { throw 'Use an admin password with at least 14 characters.' }
  if ($password -cne $confirmation) { throw 'The passwords do not match.' }
  $salt = New-Object byte[] 16
  [Security.Cryptography.RandomNumberGenerator]::Fill($salt)
  $deriver = [Security.Cryptography.Rfc2898DeriveBytes]::new(
    $password,
    $salt,
    $Iterations,
    [Security.Cryptography.HashAlgorithmName]::SHA256
  )
  try { $hash = $deriver.GetBytes(32) }
  finally { $deriver.Dispose() }
  Write-Output "pbkdf2-sha256`$$Iterations`$$(ConvertTo-Base64Url $salt)`$$(ConvertTo-Base64Url $hash)"
} finally {
  $password = $null
  $confirmation = $null
}
