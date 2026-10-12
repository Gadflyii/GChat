def nonblank: test("\\S");

if ($version | nonblank | not) then
  error("Updater version is missing or blank")
else
  .version = $version
  | .pub_date = $pub_date
  | (if $win_result == "success" then
      if ($win_sig | nonblank | not) then
        error("Windows updater signature is missing or blank")
      elif ($exe_name | nonblank | not) then
        error("Windows updater asset name is missing or blank")
      else
        .platforms["windows-x86_64"].signature = $win_sig
        | .platforms["windows-x86_64"].url = $win_url
      end
    else
      del(.platforms["windows-x86_64"])
    end)
  | (if $linux_result == "success" then
      if ($linux_sig | nonblank | not) then
        error("Linux updater signature is missing or blank")
      elif ($appimage_name | nonblank | not) then
        error("Linux updater asset name is missing or blank")
      else
        .platforms["linux-x86_64"].signature = $linux_sig
        | .platforms["linux-x86_64"].url = $linux_url
      end
    else
      del(.platforms["linux-x86_64"])
    end)
end
