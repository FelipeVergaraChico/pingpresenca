import { FormLabel } from '../FormValidation';
import { useState } from 'react';
import { api } from '../api';
import { ActionForm, Field, value } from './Form';
import type { Catalog } from './types';

export function CatalogPanel({
  catalog,
  refresh,
}: {
  catalog: Catalog;
  refresh: () => Promise<void>;
}) {
  const [disciplineId, setDisciplineId] = useState(''),
    [locationId, setLocationId] = useState('');
  const discipline = catalog.disciplines.find((d) => d.id === disciplineId),
    location = catalog.locations.find((l) => l.id === locationId);
  return (
    <section>
      <h2>Disciplinas e locais</h2>
      <div className="columns">
        <section className="editor">
          <h3>Disciplina</h3>
          <FormLabel>
            Selecionar disciplina
            <select value={disciplineId} onChange={(e) => setDisciplineId(e.target.value)}>
              <option value="">Nova disciplina</option>
              {catalog.disciplines.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </FormLabel>
          <ActionForm
            key={`${disciplineId}-${discipline?.version}`}
            submit={discipline ? 'Salvar disciplina' : 'Criar disciplina'}
            onConflict={() => void refresh()}
            onSave={async (data) => {
              await api(discipline ? `/disciplines/${discipline.id}` : '/disciplines', {
                name: value(data, 'name'),
                description: value(data, 'description'),
                ...(discipline ? { version: discipline.version } : {}),
              });
              return refresh;
            }}
          >
            <Field label="Nome da disciplina" name="name" initial={discipline?.name} />
            <FormLabel>
              Descrição
              <textarea
                name="description"
                defaultValue={discipline?.description}
                maxLength={2000}
              />
            </FormLabel>
          </ActionForm>
        </section>
        <section className="editor">
          <h3>Local autorizado</h3>
          <FormLabel>
            Selecionar local
            <select value={locationId} onChange={(e) => setLocationId(e.target.value)}>
              <option value="">Novo local</option>
              {catalog.locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </FormLabel>
          <ActionForm
            key={`${locationId}-${location?.version}`}
            submit={location ? 'Salvar local' : 'Criar local'}
            onConflict={() => void refresh()}
            onSave={async (data) => {
              await api(location ? `/locations/${location.id}` : '/locations', {
                name: value(data, 'name'),
                latitude: Number(value(data, 'latitude')),
                longitude: Number(value(data, 'longitude')),
                radius: Number(value(data, 'radius')),
                geoRequired: data.has('geoRequired'),
                ...(location ? { version: location.version } : {}),
              });
              return refresh;
            }}
          >
            <Field label="Nome do local" name="name" initial={location?.name} />
            <Field
              label="Latitude do local"
              name="latitude"
              type="number"
              min={-90}
              max={90}
              step="any"
              initial={location?.latitude}
            />
            <Field
              label="Longitude do local"
              name="longitude"
              type="number"
              min={-180}
              max={180}
              step="any"
              initial={location?.longitude}
            />
            <Field
              label="Raio permitido (metros)"
              name="radius"
              type="number"
              min="0.01"
              step="any"
              initial={location?.radius ?? 100}
            />
            <FormLabel className="checkbox-label">
              <input
                name="geoRequired"
                type="checkbox"
                defaultChecked={location?.geo_required ?? true}
              />
              Geolocalização obrigatória
            </FormLabel>
            <p className="muted">
              Critério conservador: distância + precisão ≤ raio. O professor escolhe o local, mas
              não altera a política.
            </p>
          </ActionForm>
        </section>
      </div>
    </section>
  );
}
