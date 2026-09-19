<?php
declare(strict_types=1);
// Generates a private upload config without printing secrets or overwriting a file.
if (PHP_SAPI !== 'cli' || $argc !== 3) {
    fwrite(STDERR, "Usage: php prepare-gbench-server-config.php TEMPLATE PRIVATE_DESTINATION\n");
    exit(1);
}
$config = require $argv[1];
$config['secret'] = bin2hex(random_bytes(32));
$config['publishing_enabled'] = false;
umask(0077);
$file = fopen($argv[2], 'x');
if ($file === false) exit(1);
$contents = "<?php\n// Private: upload outside public_html. Fill in database credentials locally.\nreturn "
    . var_export($config, true) . ";\n";
if (fwrite($file, $contents) !== strlen($contents)) {
    fclose($file);
    fwrite(STDERR, "Incomplete config; do not upload it.\n");
    exit(1);
}
fclose($file);
echo "Private server config prepared. Database credentials still need to be entered.\n";
