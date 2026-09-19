<?php
declare(strict_types=1);
// Run locally in WSL. The seed file belongs outside source trees and website uploads.
if (PHP_SAPI !== 'cli' || $argc !== 3 || !preg_match('/^[a-zA-Z0-9_-]{1,64}$/D', $argv[1])) {
    fwrite(STDERR,"Usage: php generate-gbench-key.php KEY_ID /private/absolute/path/gbench-signing.env\n"); exit(1);
}
$path=$argv[2];
if (!str_starts_with($path,'/')) { fwrite(STDERR,"Use an absolute private path outside source trees.\n"); exit(1); }
umask(0077);
$seed=random_bytes(SODIUM_CRYPTO_SIGN_SEEDBYTES);
$pair=sodium_crypto_sign_seed_keypair($seed);
$file=fopen($path,'x');
if ($file === false) { fwrite(STDERR,"Cannot create seed file; existing files are never overwritten.\n"); exit(1); }
$data='GBENCH_SIGNING_KEY_ID='.$argv[1]."\nGBENCH_SIGNING_SEED_HEX=".bin2hex($seed)."\n";
if (fwrite($file,$data)!==strlen($data)) { fclose($file); fwrite(STDERR,"Could not write complete seed file. Do not use it.\n"); exit(1); }
fclose($file);
echo "Private build environment saved with owner-only permissions. Do not upload it.\n";
echo "Server public-key entry: '",$argv[1],"' => '",bin2hex(sodium_crypto_sign_publickey($pair)),"'\n";
