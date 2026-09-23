import { FormLabel } from '../FormValidation';
import { api } from '../api';
import { ActionForm, Field, value } from './Form';
export function SettingsPanel({
  settings,
  refresh,
}: {
  settings: { institutional_id_required: boolean; version: number };
  refresh: () => Promise<void>;
}) {
  return (
    <section>
      <h2>Política de cadastro</h2>
      <ActionForm
        key={settings.version}
        onConflict={() => void refresh()}
        onSave={async (data) => {
          await api('/admin/settings', {
            institutionalIdRequired: data.has('institutionalIdRequired'),
            version: settings.version,
            reason: value(data, 'reason'),
          });
          return refresh;
        }}
      >
        <FormLabel className="checkbox-label">
          <input
            name="institutionalIdRequired"
            type="checkbox"
            defaultChecked={settings.institutional_id_required}
          />
          Exigir identificador institucional
        </FormLabel>
        <p>
          A política vale para novos cadastros e edições de perfil. Contas existentes, incluindo o
          owner, não são desativadas nem recebem um identificador inventado.
        </p>
        <Field label="Justificativa da política" name="reason" maxLength={1000} />
      </ActionForm>
    </section>
  );
}
