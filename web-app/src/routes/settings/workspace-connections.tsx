import { createFileRoute } from '@tanstack/react-router'
import { useCallback, useEffect, useRef, useState } from 'react'
import { route } from '@/constants/routes'
import HeaderPage from '@/containers/HeaderPage'
import SettingsMenu from '@/containers/SettingsMenu'
import { Card } from '@/containers/Card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useTranslation } from '@/i18n/react-i18next-compat'
import {
  beginConnectorAuth,
  cancelConnectorAuth,
  configureConnector,
  configureGoogleDesktopRegistration,
  connectorAccounts,
  connectorAuthStatus,
  disconnectConnectorAccount,
  importGoogleDesktopRegistration,
  selectConnectorAccount,
  type BeginConnectorAuthRequest,
  type ConfigureConnectorRequest,
  type ConnectorAccess,
  type ConnectorAccount,
  type ConnectorAccountsView,
  type ConnectorAuthFlow,
  type ConnectorConfig,
  type ConnectorProvider,
  type ConnectorService,
} from '@/services/workspace-connectors'

export const Route = createFileRoute(route.settings.workspace_connections)({
  component: WorkspaceConnections,
})

const providers: ConnectorProvider[] = ['google', 'microsoft']
const providerNames = { google: 'Google Workspace', microsoft: 'Microsoft 365' }
const serviceNames: Record<string, string> = {
  gmail: 'Gmail',
  calendar: 'Calendar',
  drive: 'Google Drive',
  docs: 'Google Docs',
  sheets: 'Google Sheets',
  slides: 'Google Slides',
  people: 'Google Contacts',
  tasks: 'Google Tasks',
  outlook: 'Outlook mail',
  contacts: 'Contacts',
  onedrive: 'OneDrive',
  sharepoint: 'SharePoint',
  teams: 'Teams',
  todo: 'Microsoft To Do',
  onenote: 'OneNote',
  excel: 'Excel',
  cloud_pc: 'Windows 365 Cloud PCs',
}
const serviceName = (id: string) => serviceNames[id] ?? id
const googleApis = [
  ['Gmail API', 'gmail.googleapis.com'],
  ['Google Calendar API', 'calendar-json.googleapis.com'],
  ['Google Drive API', 'drive.googleapis.com'],
  ['Google Docs API', 'docs.googleapis.com'],
  ['Google Sheets API', 'sheets.googleapis.com'],
  ['Google Slides API', 'slides.googleapis.com'],
  ['Google Tasks API', 'tasks.googleapis.com'],
  ['People API', 'people.googleapis.com'],
]

function GoogleRegistration({
  configured,
  disabled,
  onImport,
  onSave,
}: {
  configured: boolean
  disabled: boolean
  onImport: (file: File) => Promise<boolean>
  onSave: (clientId: string, clientSecret: string) => Promise<boolean>
}) {
  const importing = useRef(false)
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState(0)
  const [reading, setReading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')
  const titles = [
    'Create your Google project',
    'Turn on the services you need',
    'Set up the Google permission screen',
    'Download your app registration',
    'Save your Google setup',
    'Google setup is saved',
  ]
  const importFiles = async (files: readonly File[]) => {
    if (disabled || importing.current) return
    setError(null)
    setClientSecret('')
    if (files.length !== 1) {
      setError('Choose one downloaded Google Desktop app JSON file.')
      return
    }
    importing.current = true
    setReading(true)
    try {
      if (await onImport(files[0])) setStep(5)
    } catch (cause) {
      // The import service returns only sanitized validation/save errors.
      setError(
        cause instanceof Error
          ? cause.message
          : 'Could not import the Google registration. Choose the downloaded file and try again.'
      )
    } finally {
      importing.current = false
      setReading(false)
    }
  }
  const saveManualRegistration = async () => {
    if (disabled || importing.current) return
    if (!/\.apps\.googleusercontent\.com$/i.test(clientId.trim())) {
      setError(
        'That does not look like a Google Desktop client ID. It ends with .apps.googleusercontent.com. Copy it again from Google Auth Platform → Clients.'
      )
      return
    }
    importing.current = true
    setReading(true)
    setError(null)
    const secret = clientSecret
    setClientSecret('')
    try {
      if (await onSave(clientId, secret)) setStep(5)
    } catch (cause) {
      // The service returns only sanitized validation/save errors.
      setError(
        cause instanceof Error
          ? cause.message
          : 'Could not save the Google registration. Unlock secure storage if asked, then paste the Desktop client details and try again.'
      )
    } finally {
      importing.current = false
      setReading(false)
    }
  }
  const link = (href: string, label: string) => (
    <a href={href} target="_blank" rel="noreferrer" className="underline">
      {label}
    </a>
  )
  return (
    <div className="mb-4 space-y-3 text-sm">
      <p>
        {configured
          ? 'Google setup is saved. Choose your services below, then connect your account.'
          : 'First, set up your Google connection. The guided setup opens one step at a time.'}
      </p>
      <Button
        variant="outline"
        disabled={disabled}
        onClick={() => {
          setError(null)
          setClientSecret('')
          setStep(0)
          setOpen(true)
        }}
      >
        {configured ? 'Review Google setup' : 'Set up Google'}
      </Button>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!reading) {
            if (!next) setClientSecret('')
            setOpen(next)
          }
        }}
      >
        <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Set up Google Workspace</DialogTitle>
            <DialogDescription>
              Follow these steps in your browser, then return here. You can
              close this guide and reopen it later; your Google Cloud changes
              are kept.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 overflow-y-auto pr-1 text-sm">
            <p className="text-muted-foreground">
              Step {step + 1} of {titles.length}
            </p>
            <h2 className="text-base font-medium text-foreground">
              {titles[step]}
            </h2>
            {step === 0 && (
              <div className="space-y-3">
                <p>
                  Google sign-in needs an app registration in a Google Cloud
                  project you control. GChat does not include a shared Google
                  app. This one-time setup identifies your copy of GChat to
                  Google; it does not create a new Google account.
                </p>
                <ol className="list-decimal space-y-2 pl-5">
                  <li>
                    Open{' '}
                    {link(
                      'https://console.cloud.google.com/projectcreate',
                      'Google Cloud Console'
                    )}{' '}
                    and sign in with the Google account you want to connect.
                  </li>
                  <li>
                    Enter a project name, such as <strong>My GChat</strong>,
                    then select <strong>Create</strong>. If you already have a
                    project for GChat, select it using the project picker at the
                    top instead.
                  </li>
                  <li>
                    Keep that project selected throughout the following steps,
                    then return here and select <strong>Next</strong>.
                  </li>
                </ol>
                <p className="text-muted-foreground">
                  If your organization does not let you create projects, ask its
                  Google Workspace administrator to help. GChat cannot change
                  that policy.
                </p>
                <Button variant="outline" onClick={() => setStep(4)}>
                  I already have the downloaded JSON file
                </Button>
              </div>
            )}
            {step === 1 && (
              <div className="space-y-3">
                <p>
                  Each Google service needs to be enabled in your project before
                  GChat can use it.
                </p>
                <ol className="list-decimal space-y-2 pl-5">
                  <li>
                    Open a link below for each service you want to connect.
                  </li>
                  <li>
                    Check that your GChat project is selected at the top of the
                    Google page, then select <strong>Enable</strong>. If the
                    page says <strong>Manage</strong>, that service is already
                    enabled.
                  </li>
                  <li>
                    Return to this guide after enabling your services, then
                    select <strong>Next</strong>.
                  </li>
                </ol>
                <ul className="grid list-disc gap-2 pl-5 sm:grid-cols-2">
                  {googleApis.map(([name, id]) => (
                    <li key={id}>
                      {link(
                        `https://console.cloud.google.com/apis/enableflow;apiid=${id}`,
                        name
                      )}
                    </li>
                  ))}
                </ul>
                <p className="text-muted-foreground">
                  Google Drive is also used to open files for Docs, Sheets and
                  Slides. Enable Google Drive API if you need those services.
                </p>
              </div>
            )}
            {step === 2 && (
              <div className="space-y-3">
                <p>
                  This tells Google what name to show when you approve access to
                  your account.
                </p>
                <ol className="list-decimal space-y-2 pl-5">
                  <li>
                    Open{' '}
                    {link(
                      'https://console.cloud.google.com/auth/branding',
                      'Branding'
                    )}
                    . If shown, select <strong>Get started</strong>. Enter{' '}
                    <strong>My GChat</strong> as the app name and choose your
                    email for user support.
                  </li>
                  <li>
                    Select <strong>Next</strong>. For a personal Google account,
                    choose <strong>External</strong> as the audience. An
                    organization-only setup can use Internal if its
                    administrator permits it.
                  </li>
                  <li>
                    Continue to contact information, enter your email, review
                    the policy and complete <strong>Create</strong>. If setup
                    was already complete, review those fields instead.
                  </li>
                  <li>
                    Open{' '}
                    {link(
                      'https://console.cloud.google.com/auth/audience',
                      'Audience'
                    )}
                    . While Testing, add your own Google email as a test user
                    using <strong>Add users</strong>, then <strong>Save</strong>
                    .
                  </li>
                  <li>
                    Open{' '}
                    {link(
                      'https://console.cloud.google.com/auth/scopes',
                      'Data Access'
                    )}
                    . Review the permissions for the services you enabled and
                    choose only the access you intend to grant.
                  </li>
                  <li>
                    For a lasting connection, set the publishing status to{' '}
                    <strong>In production</strong> when Google permits it.{' '}
                    {link(
                      'https://developers.google.com/identity/protocols/oauth2#expiration',
                      'Testing refresh tokens expire after seven days'
                    )}{' '}
                    with the service permissions used here, so Testing may
                    require you to reconnect. Publishing does not itself verify
                    your app.
                  </li>
                </ol>
                <p>
                  For more detail, open Google’s{' '}
                  {link(
                    'https://developers.google.com/workspace/guides/configure-oauth-consent',
                    'permission screen setup guide'
                  )}
                  . If your organization blocks this setup, ask its
                  administrator rather than changing organization settings.
                </p>
              </div>
            )}
            {step === 3 && (
              <div className="space-y-3">
                <ol className="list-decimal space-y-2 pl-5">
                  <li>
                    Open{' '}
                    {link(
                      'https://console.cloud.google.com/auth/clients',
                      'Clients'
                    )}{' '}
                    in the same Google project.
                  </li>
                  <li>
                    Select <strong>Create client</strong>, choose{' '}
                    <strong>Desktop app</strong> for Application type, enter a
                    name such as <strong>GChat desktop</strong>, then select{' '}
                    <strong>Create</strong>.
                  </li>
                  <li>
                    Download the client’s JSON file. If the creation window is
                    closed, open the new client in the client list and use its
                    download option.
                  </li>
                  <li>
                    Keep the file private and return to this guide. Select{' '}
                    <strong>Next</strong> to import it. If you cannot download
                    the file, copy the Desktop client ID and secret into the
                    alternative form on the next step instead. Do not put these
                    app credentials in chat.
                  </li>
                </ol>
                <p>
                  Google Desktop apps use a temporary local callback at{' '}
                  <code>http://127.0.0.1:&lt;port&gt;/oauth/callback</code>.
                  Choose Desktop app when creating the client; you do not need
                  to register a website redirect.
                </p>
                <p>
                  Need help finding the download? Open Google’s{' '}
                  {link(
                    'https://developers.google.com/workspace/gmail/api/quickstart/python#authorize_credentials_for_a_desktop_application',
                    'Desktop app instructions'
                  )}
                  ; only the desktop registration section applies here.
                </p>
              </div>
            )}
            {step === 4 && (
              <div className="space-y-3">
                <div
                  role="group"
                  aria-label="Google Desktop app JSON import"
                  aria-busy={reading}
                  className="space-y-3 rounded border border-border p-3"
                >
                  <p>
                    Choose the JSON file you downloaded for the Desktop app.
                    Importing it saves the registration; it does not sign you in
                    yet.
                  </p>
                  <label className="block">
                    Import Google Desktop app JSON
                    <Input
                      type="file"
                      accept=".json,application/json"
                      disabled={disabled || reading}
                      onChange={(event) => {
                        const files = Array.from(event.target.files ?? [])
                        event.target.value = ''
                        void importFiles(files)
                      }}
                    />
                  </label>
                  <p>Choose one downloaded JSON file, up to 64 KB.</p>
                  <p>
                    The app secret goes directly to GChat’s protected credential
                    store. GChat does not display or keep it in this form.
                  </p>
                </div>
                <details>
                  <summary className="cursor-pointer text-foreground">
                    Paste a Desktop client ID and secret instead
                  </summary>
                  <form
                    className="mt-3 space-y-3"
                    onSubmit={(event) => {
                      event.preventDefault()
                      void saveManualRegistration()
                    }}
                  >
                    <p>
                      In Google Auth Platform → Clients, open the Desktop app
                      you created and copy its Client ID and Client secret.
                      These are app credentials, not your Google password.
                    </p>
                    <label className="block">
                      Google Desktop client ID
                      <Input
                        value={clientId}
                        autoComplete="off"
                        spellCheck={false}
                        maxLength={4096}
                        disabled={disabled || reading}
                        onChange={(event) => setClientId(event.target.value)}
                      />
                    </label>
                    <label className="block">
                      Google Desktop client secret
                      <Input
                        type="password"
                        value={clientSecret}
                        autoComplete="new-password"
                        spellCheck={false}
                        maxLength={4096}
                        disabled={disabled || reading}
                        onChange={(event) => setClientSecret(event.target.value)}
                      />
                    </label>
                    <p>
                      Save sends the secret to the same protected credential
                      store used for sign-in tokens, then clears this field,
                      including if saving fails.
                    </p>
                    <Button
                      type="submit"
                      variant="outline"
                      size="sm"
                      disabled={
                        disabled ||
                        reading ||
                        !clientId.trim() ||
                        !clientSecret.trim()
                      }
                    >
                      Save Google registration
                    </Button>
                  </form>
                </details>
                {configured && (
                  <p>
                    Google registration saved. Saving a different registration
                    requires reconnecting existing accounts.
                  </p>
                )}
                {reading && <p role="status">Saving your Google setup…</p>}
                {error && (
                  <p role="alert" className="text-destructive">
                    {error}
                  </p>
                )}
              </div>
            )}
            {step === 5 && (
              <div className="space-y-3">
                <p role="status">
                  Your Google registration has been saved in GChat. Your account
                  is not connected yet.
                </p>
                <ol className="list-decimal space-y-2 pl-5">
                  <li>
                    Select <strong>Choose services</strong> below to return to
                    Workspace connections.
                  </li>
                  <li>
                    Select the Google services you enabled and choose Read only
                    or Read and write.
                  </li>
                  <li>
                    Select <strong>Connect Google Workspace</strong>, sign in to
                    the account you added and review Google’s permissions.
                    Keep GChat open while signing in. Your browser returns the
                    result automatically; do not paste a callback URL or
                    authorization code anywhere. Return to GChat and wait for
                    the account to appear under{' '}
                    <strong>Connected accounts</strong>.
                  </li>
                </ol>
                <p>
                  For your own unverified app, Google may show{' '}
                  <strong>Advanced → Go to your app (unsafe)</strong>. Continue
                  only if you recognize your own project and the displayed
                  account and permissions. This does not bypass an organization
                  block. If Google requires administrator approval, ask your
                  administrator.
                </p>
              </div>
            )}
          </div>
          <DialogFooter className="gap-2 border-t border-border pt-3">
            <Button
              variant="outline"
              disabled={reading}
              onClick={() =>
                step === 0 ? setOpen(false) : setStep((current) => current - 1)
              }
            >
              {step === 0 ? 'Close setup' : 'Back'}
            </Button>
            {step < 4 && (
              <Button
                disabled={disabled}
                onClick={() => setStep((current) => current + 1)}
              >
                Next
              </Button>
            )}
            {step === 5 && (
              <Button onClick={() => setOpen(false)}>Choose services</Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

type ProviderCardProps = {
  provider: ConnectorProvider
  config?: ConnectorConfig
  services: ConnectorService[]
  accounts: ConnectorAccount[]
  selectedAccount?: string
  authFlow?: ConnectorAuthFlow
  authError?: string
  refreshing: boolean
  busy: boolean
  disabled: boolean
  onConfigure: (request: ConfigureConnectorRequest) => Promise<void>
  onImportGoogle: (file: File) => Promise<boolean>
  onSaveGoogle: (clientId: string, clientSecret: string) => Promise<boolean>
  onConnect: (request: BeginConnectorAuthRequest) => Promise<void>
  onSelect: (account: ConnectorAccount) => Promise<void>
  onDisconnect: (account: ConnectorAccount) => void
  onCancelAuth: (flowId: string) => Promise<void>
  onCheckAuth: () => void
  onRefreshAccounts: () => Promise<void>
  onRestartAuth: () => void
}

function ProviderCard({
  provider,
  config,
  services,
  accounts,
  selectedAccount,
  authFlow,
  authError,
  refreshing,
  busy,
  disabled,
  onConfigure,
  onImportGoogle,
  onSaveGoogle,
  onConnect,
  onSelect,
  onDisconnect,
  onCancelAuth,
  onCheckAuth,
  onRefreshAccounts,
  onRestartAuth,
}: ProviderCardProps) {
  const [clientId, setClientId] = useState(config?.client_id ?? '')
  const [tenant, setTenant] = useState(config?.tenant ?? '')
  const [selectedServices, setSelectedServices] = useState<string[]>([])
  const [access, setAccess] = useState<ConnectorAccess>('read_only')

  useEffect(() => {
    setClientId(config?.client_id ?? '')
    setTenant(config?.tenant ?? '')
  }, [config?.client_id, config?.tenant, config?.has_client_secret])

  const saveRegistration = async () => {
    await onConfigure({
      provider,
      client_id: clientId.trim(),
      ...(provider === 'microsoft' && tenant.trim()
        ? { tenant: tenant.trim() }
        : {}),
    })
  }
  const requestedScopes = [
    ...new Set(
      services
        .filter((service) => selectedServices.includes(service.id))
        .flatMap((service) =>
          access === 'read_only' ? service.read_scopes : service.write_scopes
        )
    ),
  ]
  const connectedAccount =
    authFlow?.status === 'connected'
      ? accounts.find(
          (account) =>
            !account.needs_reconnect &&
            (!authFlow.account_id || account.id === authFlow.account_id)
        )
      : undefined
  const signInLabel =
    authFlow?.status === 'waiting'
      ? 'Waiting for browser sign-in…'
      : authFlow?.status === 'failed' || authError
        ? `Try ${provider === 'microsoft' ? 'Microsoft' : 'Google'} sign-in again`
        : accounts.length > 0
          ? provider === 'microsoft'
            ? 'Sign in another Microsoft account'
            : 'Connect another Google account'
          : provider === 'microsoft'
            ? 'Sign in with Microsoft'
            : `Connect ${providerNames[provider]}`

  return (
    <Card title={providerNames[provider]}>
      {provider === 'google' ? (
        <GoogleRegistration
          configured={Boolean(config?.client_id)}
          disabled={disabled}
          onImport={onImportGoogle}
          onSave={onSaveGoogle}
        />
      ) : (
        <details className="mb-4">
          <summary className="cursor-pointer text-foreground">
            Advanced: use your organization’s Microsoft app
          </summary>
          <div className="my-3 space-y-2 text-sm">
            <p>
              Only use this option if your organization has an approved app
              registration. Ask your Microsoft administrator for these details.
              Changing the app requires reconnecting existing accounts.
            </p>
            <ol className="list-decimal space-y-1 pl-5">
              <li>
                In Microsoft Entra → App registrations, open the approved app
                and copy its Application (client) ID into Client ID below.
              </li>
              <li>
                Confirm its Mobile and desktop applications redirect URI is{' '}
                <code>http://localhost/oauth/callback</code>. A client secret is
                not needed.
              </li>
              <li>
                Enter the directory (tenant) ID if your administrator requires
                one. Otherwise leave Tenant blank to use common for work, school
                and personal accounts. The app registration must support your
                account type.
              </li>
              <li>
                Save the registration, choose the services you need, then select
                Sign in with Microsoft. Complete sign-in and any permission
                approval in your browser.
              </li>
            </ol>
            <p>
              Cloud PCs require a work or school account with an assigned
              Windows 365 Cloud PC. Your organization may require administrator
              approval.
            </p>
          </div>
          <form
            className="space-y-3"
            onSubmit={(event) => {
              event.preventDefault()
              void saveRegistration()
            }}
          >
            <label className="block text-sm">
              Client ID
              <Input
                value={clientId}
                onChange={(event) => setClientId(event.target.value)}
                disabled={disabled}
              />
            </label>
            {provider === 'microsoft' && (
              <label className="block text-sm">
                Tenant (optional)
                <Input
                  value={tenant}
                  onChange={(event) => setTenant(event.target.value)}
                  disabled={disabled}
                  placeholder="common"
                />
              </label>
            )}
            <Button
              type="submit"
              variant="outline"
              size="sm"
              disabled={disabled || !clientId.trim()}
            >
              Save {providerNames[provider]} registration
            </Button>
          </form>
        </details>
      )}
      {provider === 'microsoft' ? (
        <>
          <p className="mb-3 text-sm">
            {config?.client_id
              ? 'Choose the services you need, then sign in with Microsoft in your browser. The app registration is already set up; you do not need to enter an app ID.'
              : 'Microsoft sign-in is unavailable in this GChat build. You do not need to find or create an app ID. Install a release that includes Microsoft sign-in, or use the advanced option if your organization already has an approved app.'}
          </p>
          <p className="mb-3 text-sm">
            Connect a work, school or personal Microsoft account, including
            Outlook.com, Hotmail and personal OneDrive. Available services
            depend on your account.
          </p>
        </>
      ) : null}
      {(authFlow || authError) && (
        <section
          aria-label={`${providerNames[provider]} sign-in progress`}
          role={authFlow?.status === 'failed' || authError ? 'alert' : 'status'}
          className="mb-4 space-y-2 rounded border border-border p-3 text-sm"
        >
          {authFlow?.status === 'waiting' && (
            <>
              <p className="font-medium">
                Complete {providerNames[provider]} sign-in in your browser.
              </p>
              <p>
                After approving access, return here. GChat is waiting for the
                browser response and will show your account under Connected
                accounts only after saving the connection.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => void onCancelAuth(authFlow.flow_id)}
                >
                  Cancel {providerNames[provider]} sign-in
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={onCheckAuth}
                >
                  Check sign-in status
                </Button>
              </div>
            </>
          )}
          {authFlow?.status === 'connected' &&
            (connectedAccount ? (
              <>
                <p className="font-medium">
                  {providerNames[provider]} account connected.
                </p>
                <p>
                  {connectedAccount.email ||
                    connectedAccount.display_name ||
                    'Your account'}{' '}
                  is saved and appears in Connected accounts below. You can
                  return to Chat or Gbot and select this account.
                </p>
              </>
            ) : (
              <>
                <p className="font-medium">
                  {refreshing
                    ? 'Finishing your connection…'
                    : 'Sign-in received. Confirm your saved account.'}
                </p>
                <p>
                  Browser sign-in has finished, but GChat has not displayed the
                  saved account yet. Refresh the account list before continuing.
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy || refreshing}
                  onClick={() => void onRefreshAccounts()}
                >
                  Refresh connected accounts
                </Button>
                {!refreshing && (
                  <>
                    <p>
                      If refreshing still shows no account, start sign-in again
                      and choose your services below.
                    </p>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={onRestartAuth}
                    >
                      Start sign-in again
                    </Button>
                  </>
                )}
              </>
            ))}
          {authFlow?.status === 'cancelled' && (
            <>
              <p>Sign-in cancelled.</p>
              <p>
                Select the services you need below when you are ready to try
                again.
              </p>
            </>
          )}
          {(authFlow?.status === 'failed' || authError) && (
            <>
              <p className="font-medium text-destructive">
                {providerNames[provider]} was not connected.
              </p>
              <p>
                {authError ||
                  authFlow?.error ||
                  'GChat could not finish saving the connection.'}
              </p>
              <p>
                Follow the message above, then select the services you need and
                choose Try {provider === 'microsoft' ? 'Microsoft' : 'Google'}{' '}
                sign-in again below. A browser success page alone does not mean
                the account was saved.
              </p>
            </>
          )}
        </section>
      )}
      <fieldset disabled={disabled} className="space-y-3">
        <legend className="mb-2 font-medium text-foreground">
          Services to connect
        </legend>
        <p className="text-sm">
          Select only the services you want GChat to use. You will review the
          requested access on the sign-in page before connecting.
        </p>
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          {services.map((service) => (
            <label key={service.id} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={selectedServices.includes(service.id)}
                onChange={(event) => {
                  setSelectedServices((current) =>
                    event.target.checked
                      ? [...current, service.id]
                      : current.filter((id) => id !== service.id)
                  )
                }}
              />
              {serviceName(service.id)}
            </label>
          ))}
        </div>
        {provider === 'microsoft' &&
          selectedServices.some((service) =>
            ['sharepoint', 'teams', 'cloud_pc'].includes(service)
          ) && (
            <p className="text-sm">
              This needs a work or school account. SharePoint, Teams and Windows
              365 Cloud PCs are organization services. Your organization may
              also need to approve access or assign a license.
            </p>
          )}
        <label className="flex items-center gap-3 text-sm">
          Access
          <select
            className="rounded border border-border bg-background px-2 py-1 text-foreground"
            value={access}
            onChange={(event) =>
              setAccess(event.target.value as ConnectorAccess)
            }
          >
            <option value="read_only">Read only</option>
            <option value="read_write">Read and write</option>
          </select>
        </label>
        <p className="text-xs">
          Choose Read only to let GChat look up information without changing it,
          or Read and write if you want it to make changes with your approval.
          Read only prevents GChat from writing. Provider consent can include
          broader permissions required for a service.
        </p>
        {requestedScopes.length > 0 && (
          <details className="text-xs">
            <summary className="cursor-pointer">
              Requested service permissions
            </summary>
            <ul className="mt-2 space-y-1 break-all">
              {requestedScopes.map((scope) => (
                <li key={scope}>{scope}</li>
              ))}
            </ul>
          </details>
        )}
        {Boolean(config?.client_id) && selectedServices.length === 0 && (
          <p id={`${provider}-select-service`} className="text-sm">
            Select at least one service above to continue.
          </p>
        )}
        <Button
          aria-describedby={
            config?.client_id && selectedServices.length === 0
              ? `${provider}-select-service`
              : undefined
          }
          disabled={
            disabled ||
            !config?.client_id ||
            selectedServices.length === 0 ||
            (authFlow?.status === 'connected' && !connectedAccount)
          }
          onClick={() =>
            void onConnect({ provider, services: selectedServices, access })
          }
        >
          {signInLabel}
        </Button>
      </fieldset>
      <div className="mt-5 border-t border-border pt-3">
        <h2 className="mb-2 font-medium text-foreground">Connected accounts</h2>
        {accounts.length === 0 && (
          <p className="text-sm">No connected accounts.</p>
        )}
        {accounts.map((account) => (
          <section
            key={account.id}
            className="mb-3 rounded border border-border p-3"
            aria-label={
              account.display_name || account.email || account.subject
            }
          >
            <div className="flex flex-wrap justify-between gap-2">
              <div className="min-w-0">
                <p className="break-all font-medium text-foreground">
                  {account.display_name || account.email || account.subject}
                </p>
                {account.email && (
                  <p className="break-all text-sm">{account.email}</p>
                )}
                <p className="text-sm">
                  {account.needs_reconnect ? 'Reconnect required' : 'Connected'}
                  {selectedAccount === account.id ? ' · Default account' : ''}
                </p>
                <p className="text-xs">
                  {account.services.map(serviceName).join(', ')} ·{' '}
                  {account.access === 'read_only'
                    ? 'Read only'
                    : 'Read and write'}
                </p>
                {account.granted_scopes.length > 0 && (
                  <details className="mt-1 text-xs">
                    <summary className="cursor-pointer">
                      Granted provider permissions
                    </summary>
                    <ul className="mt-2 space-y-1 break-all">
                      {account.granted_scopes.map((scope) => (
                        <li key={scope}>{scope}</li>
                      ))}
                    </ul>
                  </details>
                )}
              </div>
              <div className="flex flex-wrap items-start gap-2">
                {selectedAccount !== account.id && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={disabled}
                    onClick={() => void onSelect(account)}
                  >
                    Make default
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  disabled={disabled || !config?.client_id}
                  onClick={() =>
                    void onConnect({
                      provider,
                      services: account.services,
                      access: account.access,
                      account_id: account.id,
                    })
                  }
                >
                  Reconnect
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={disabled}
                  onClick={() => onDisconnect(account)}
                >
                  Disconnect
                </Button>
              </div>
            </div>
          </section>
        ))}
      </div>
    </Card>
  )
}

export function WorkspaceConnections() {
  const { t } = useTranslation()
  const [view, setView] = useState<ConnectorAccountsView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [flows, setFlows] = useState<ConnectorAuthFlow[]>([])
  const [authErrors, setAuthErrors] = useState<
    Partial<Record<ConnectorProvider, string>>
  >({})
  const [pollingPaused, setPollingPaused] = useState(false)
  const [disconnecting, setDisconnecting] = useState<ConnectorAccount | null>(
    null
  )
  const [revoke, setRevoke] = useState(false)
  const snapshotSequence = useRef(0)
  const flowSequence = useRef(0)

  const receiveSnapshot = useCallback((next: ConnectorAccountsView) => {
    setView(next)
    setLoading(false)
    setFlows((current) => [
      ...current.filter(
        (known) =>
          known.status !== 'waiting' &&
          !next.active_flows.some(
            (active) => active.provider === known.provider
          )
      ),
      ...next.active_flows,
    ])
  }, [])

  const loadAccounts = useCallback(async () => {
    const sequence = ++snapshotSequence.current
    setLoading(true)
    try {
      const next = await connectorAccounts()
      if (sequence === snapshotSequence.current) {
        receiveSnapshot(next)
        setError(null)
      }
    } catch (cause) {
      if (sequence === snapshotSequence.current) setError(String(cause))
    } finally {
      if (sequence === snapshotSequence.current) setLoading(false)
    }
  }, [receiveSnapshot])

  useEffect(() => {
    const snapshotRef = snapshotSequence
    const flowRef = flowSequence
    void loadAccounts()
    return () => {
      snapshotRef.current++
      flowRef.current++
    }
  }, [loadAccounts])

  useEffect(() => {
    const waiting = flows.filter((flow) => flow.status === 'waiting')
    if (waiting.length === 0 || pollingPaused) return
    let disposed = false
    const sequence = flowSequence.current
    const timer = setTimeout(async () => {
      const results = await Promise.allSettled(
        waiting.map((flow) => connectorAuthStatus(flow.flow_id))
      )
      if (disposed || sequence !== flowSequence.current) return
      const updates = new Map<string, ConnectorAuthFlow>()
      for (const result of results) {
        if (result.status === 'fulfilled')
          updates.set(result.value.flow_id, result.value)
        else {
          setError(
            `Could not check sign-in status. Use Check sign-in status to retry. ${String(result.reason)}`
          )
          setPollingPaused(true)
        }
      }
      if (updates.size > 0)
        setFlows((current) =>
          current.map((flow) => updates.get(flow.flow_id) ?? flow)
        )
      if ([...updates.values()].some((flow) => flow.status === 'connected'))
        await loadAccounts()
    }, 1000)
    return () => {
      disposed = true
      clearTimeout(timer)
    }
  }, [flows, pollingPaused, loadAccounts])

  const perform = async (name: string, operation: () => Promise<void>) => {
    setBusy(name)
    setError(null)
    snapshotSequence.current++
    setLoading(false)
    try {
      await operation()
    } catch (cause) {
      setError(String(cause))
    } finally {
      setBusy(null)
    }
  }
  const acceptSnapshot = (next: ConnectorAccountsView) => {
    snapshotSequence.current++
    receiveSnapshot(next)
  }
  const connect = (request: BeginConnectorAuthRequest) =>
    perform('Opening sign-in', async () => {
      flowSequence.current++
      setFlows((current) =>
        current.filter((flow) => flow.provider !== request.provider)
      )
      setAuthErrors((current) => ({
        ...current,
        [request.provider]: undefined,
      }))
      setPollingPaused(false)
      try {
        const next = await beginConnectorAuth(request)
        setFlows((current) => [...current, next])
        if (next.status === 'connected') await loadAccounts()
      } catch (cause) {
        setAuthErrors((current) => ({
          ...current,
          [request.provider]: String(cause),
        }))
        throw cause
      }
    })
  const cancel = (flowId: string) =>
    perform('Cancelling sign-in', async () => {
      flowSequence.current++
      setPollingPaused(false)
      try {
        const next = await cancelConnectorAuth(flowId)
        setFlows((current) =>
          current.map((flow) => (flow.flow_id === next.flow_id ? next : flow))
        )
        if (next.status === 'connected') await loadAccounts()
      } catch (cause) {
        setFlows((current) => [...current])
        throw cause
      }
    })
  const disabled =
    loading || busy !== null || flows.some((flow) => flow.status === 'waiting')

  return (
    <div className="flex h-svh w-full flex-col">
      <HeaderPage>
        <span className="font-studio text-base font-medium">
          {t('common:settings')}
        </span>
      </HeaderPage>
      <div className="flex h-[calc(100%-60px)]">
        <SettingsMenu />
        <main className="w-full space-y-4 overflow-y-auto p-4">
          <div className="flex items-center justify-between gap-3">
            <h1 className="text-lg font-medium">Workspace connections</h1>
            <Button
              size="sm"
              variant="outline"
              disabled={loading || busy !== null}
              onClick={() => void loadAccounts()}
            >
              Refresh accounts
            </Button>
          </div>
          <p className="text-sm text-muted-foreground">
            Connect the Google or Microsoft account you want to use in Chat,
            Agent, Code or Gbot. Choose the services you need below, then sign
            in through your browser. GChat keeps your saved sign-in in secure
            storage; you do not enter your account password in GChat.
          </p>
          {error && !disconnecting && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          {busy && (
            <p role="status" className="text-sm">
              {busy}…
            </p>
          )}
          {loading && !view && <p role="status">Loading accounts…</p>}
          {!loading && !view && (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">
                Choose Connect account service to check secure storage and show
                your saved accounts and sign-in options. Your computer may ask
                you to unlock its password storage first.
              </p>
              <Button
                disabled={busy !== null}
                onClick={() =>
                  void perform('Connecting account service', async () =>
                    acceptSnapshot(await connectorAccounts(true))
                  )
                }
              >
                Connect account service
              </Button>
            </div>
          )}
          {view &&
            providers.map((provider) => (
              <ProviderCard
                key={provider}
                provider={provider}
                config={view.configs.find(
                  (config) => config.provider === provider
                )}
                services={view.services[provider]}
                accounts={view.accounts.filter(
                  (account) => account.provider === provider
                )}
                selectedAccount={view.selected_accounts[provider]}
                authFlow={flows.find((flow) => flow.provider === provider)}
                authError={authErrors[provider]}
                refreshing={loading}
                busy={busy !== null}
                disabled={disabled}
                onCancelAuth={cancel}
                onCheckAuth={() => {
                  setError(null)
                  setPollingPaused(false)
                  setFlows((current) => [...current])
                }}
                onRefreshAccounts={loadAccounts}
                onRestartAuth={() => {
                  setFlows((current) =>
                    current.filter((flow) => flow.provider !== provider)
                  )
                  setAuthErrors((current) => ({
                    ...current,
                    [provider]: undefined,
                  }))
                }}
                onConfigure={(request) =>
                  perform('Saving registration', async () =>
                    acceptSnapshot(await configureConnector(request))
                  )
                }
                onImportGoogle={async (file) => {
                  setBusy('Importing Google registration')
                  setError(null)
                  try {
                    acceptSnapshot(await importGoogleDesktopRegistration(file))
                    return true
                  } finally {
                    setBusy(null)
                  }
                }}
                onSaveGoogle={async (clientId, clientSecret) => {
                  setBusy('Saving Google registration')
                  setError(null)
                  try {
                    acceptSnapshot(
                      await configureGoogleDesktopRegistration(
                        clientId,
                        clientSecret
                      )
                    )
                    return true
                  } finally {
                    setBusy(null)
                  }
                }}
                onConnect={connect}
                onSelect={(account) =>
                  perform('Selecting default account', async () =>
                    acceptSnapshot(
                      await selectConnectorAccount(account.provider, account.id)
                    )
                  )
                }
                onDisconnect={(account) => {
                  setError(null)
                  setDisconnecting(account)
                  setRevoke(false)
                }}
              />
            ))}
        </main>
      </div>
      <Dialog
        open={disconnecting !== null}
        onOpenChange={(open) => {
          if (!open && !busy) setDisconnecting(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Disconnect account</DialogTitle>
            <DialogDescription>
              Remove this connection from all GChat modes. Other accounts are
              kept.
            </DialogDescription>
          </DialogHeader>
          <p className="break-all">
            {disconnecting?.email || disconnecting?.display_name}
          </p>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          {disconnecting?.provider === 'google' ? (
            <label className="flex gap-2 items-center text-sm">
              <input
                type="checkbox"
                checked={revoke}
                onChange={(event) => setRevoke(event.target.checked)}
                disabled={busy !== null}
              />
              Also revoke Google access
            </label>
          ) : (
            <p className="text-sm text-muted-foreground">
              This removes local access. To remove Microsoft’s consent too, use
              your Microsoft account’s app permissions page.
            </p>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              disabled={busy !== null}
              onClick={() => setDisconnecting(null)}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={busy !== null}
              onClick={() => {
                if (!disconnecting) return
                const account = disconnecting
                void perform('Disconnecting account', async () => {
                  acceptSnapshot(
                    await disconnectConnectorAccount(
                      account.provider,
                      account.id,
                      revoke
                    )
                  )
                  setDisconnecting(null)
                })
              }}
            >
              Disconnect account
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
