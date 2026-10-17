import { createFileRoute } from '@tanstack/react-router'
import { route } from '@/constants/routes'
import HeaderPage from '@/containers/HeaderPage'
import SettingsMenu from '@/containers/SettingsMenu'
import { Card, CardItem } from '@/containers/Card'
import { Switch } from '@/components/ui/switch'
import { useTranslation } from '@/i18n/react-i18next-compat'
import { Input } from '@/components/ui/input'
import { EyeOff, Eye } from 'lucide-react'
import { useCallback, useId, useState } from 'react'
import { useProxyConfig } from '@/hooks/useProxyConfig'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const Route = createFileRoute(route.settings.https_proxy as any)({
  component: HTTPSProxyContent,
})

function HTTPSProxyContent() {
  const { t } = useTranslation()
  const proxyId = useId()
  const [showPassword, setShowPassword] = useState(false)
  const {
    proxyUrl,
    proxyEnabled,
    proxyUsername,
    proxyPassword,
    proxyIgnoreSSL,
    noProxy,
    setProxyEnabled,
    setProxyUsername,
    setProxyPassword,
    setProxyIgnoreSSL,
    setNoProxy,
    setProxyUrl,
  } = useProxyConfig()

  const toggleProxy = useCallback(
    (checked: boolean) => {
      setProxyEnabled(checked)
    },
    [setProxyEnabled]
  )

  return (
    <div className="flex flex-col h-svh w-full">
      <HeaderPage>
        <div className="flex items-center gap-2 w-full">
          <span className='font-medium text-base font-studio'>{t('common:settings')}</span>
        </div>
      </HeaderPage>
      <div className="flex h-[calc(100%-60px)]">
        <SettingsMenu />
        <div className="p-4 pt-0 w-full overflow-y-auto">
          <div className="flex flex-col justify-between gap-4 gap-y-3 w-full">
            {/* Proxy Configuration */}
            <Card
              header={
                <div className="flex items-center justify-between">
                  <h2 className="text-foreground font-studio font-medium text-base mb-2">
                    <label htmlFor={`${proxyId}-enabled`}>
                      {t('settings:httpsProxy.proxy')}
                    </label>
                  </h2>
                  <Switch
                    id={`${proxyId}-enabled`}
                    aria-describedby={`${proxyId}-url-description`}
                    checked={proxyEnabled}
                    onCheckedChange={toggleProxy}
                  />
                </div>
              }
            >
              <CardItem
                title={
                  <label htmlFor={`${proxyId}-url`}>
                    {t('settings:httpsProxy.proxyUrl')}
                  </label>
                }
                className="block"
                description={
                  <div className="space-y-2">
                    <p id={`${proxyId}-url-description`}>
                      {t('settings:httpsProxy.proxyUrlDesc')}
                    </p>
                    <Input
                      id={`${proxyId}-url`}
                      aria-describedby={`${proxyId}-url-description`}
                      className="w-full"
                      placeholder={t('settings:httpsProxy.proxyUrlPlaceholder')}
                      value={proxyUrl}
                      onChange={(e) => setProxyUrl(e.target.value)}
                    />
                  </div>
                }
              />
              <CardItem
                title={t('settings:httpsProxy.authentication')}
                className="block"
                description={
                  <div className="space-y-2">
                    <p id={`${proxyId}-authentication-description`}>
                      {t('settings:httpsProxy.authenticationDesc')}
                    </p>
                    <div className="flex gap-2">
                      <div className="flex-1 min-w-0 space-y-1">
                        <label htmlFor={`${proxyId}-username`}>
                          {t('settings:httpsProxy.username')}
                        </label>
                        <Input
                          id={`${proxyId}-username`}
                          aria-describedby={`${proxyId}-authentication-description`}
                          placeholder={t('settings:httpsProxy.username')}
                          value={proxyUsername}
                          onChange={(e) => setProxyUsername(e.target.value)}
                        />
                      </div>
                      <div className="min-w-0 w-1/2 space-y-1">
                        <label htmlFor={`${proxyId}-password`}>
                          {t('settings:httpsProxy.password')}
                        </label>
                        <div className="relative">
                          <Input
                            id={`${proxyId}-password`}
                            aria-describedby={`${proxyId}-authentication-description`}
                            type={showPassword ? 'text' : 'password'}
                            placeholder={t('settings:httpsProxy.password')}
                            className="pr-16"
                            value={proxyPassword}
                            onChange={(e) => setProxyPassword(e.target.value)}
                          />
                          <div className="absolute right-2 top-1/2 transform -translate-y-1/2 flex items-center gap-1">
                            <button
                              type="button"
                              aria-label={
                                showPassword
                                  ? t('settings:httpsProxy.hidePassword', {
                                      defaultValue: 'Hide proxy password',
                                    })
                                  : t('settings:httpsProxy.showPassword', {
                                      defaultValue: 'Show proxy password',
                                    })
                              }
                              aria-controls={`${proxyId}-password`}
                              onClick={() => setShowPassword(!showPassword)}
                              className="p-1 rounded hover:bg-foreground/5 text-foreground/70"
                            >
                              {showPassword ? (
                                <EyeOff size={16} />
                              ) : (
                                <Eye size={16} />
                              )}
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                }
              />
              <CardItem
                title={
                  <label htmlFor={`${proxyId}-no-proxy`}>
                    {t('settings:httpsProxy.noProxy')}
                  </label>
                }
                className="block"
                description={
                  <div className="space-y-2">
                    <p id={`${proxyId}-no-proxy-description`}>
                      {t('settings:httpsProxy.noProxyDesc')}
                    </p>
                    <Input
                      id={`${proxyId}-no-proxy`}
                      aria-describedby={`${proxyId}-no-proxy-description`}
                      placeholder={t('settings:httpsProxy.noProxyPlaceholder')}
                      value={noProxy}
                      onChange={(e) => setNoProxy(e.target.value)}
                    />
                  </div>
                }
              />
              <CardItem
                title={
                  <label htmlFor={`${proxyId}-ignore-ssl`}>
                    {t('settings:httpsProxy.ignoreSsl')}
                  </label>
                }
                description={
                  <span id={`${proxyId}-ignore-ssl-description`}>
                    {t('settings:httpsProxy.ignoreSslDesc')}
                  </span>
                }
                actions={
                  <Switch
                    id={`${proxyId}-ignore-ssl`}
                    aria-describedby={`${proxyId}-ignore-ssl-description`}
                    checked={proxyIgnoreSSL}
                    onCheckedChange={(checked) => setProxyIgnoreSSL(checked)}
                  />
                }
              />
            </Card>
          </div>
        </div>
      </div>
    </div>
  )
}
