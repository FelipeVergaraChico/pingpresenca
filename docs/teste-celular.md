# Testar QR e localização no celular antes da produção

Não é necessário publicar a aplicação em produção. O celular precisa alcançar o servidor de teste por um endereço apropriado.

`localhost` sempre identifica o aparelho que abre a URL. Um QR com `http://localhost:5173` abre a porta 5173 do celular, não do computador. O QR é construído pelo backend a partir de `PUBLIC_ORIGIN`.

## Opções

- **HTTPS na rede local:** computador e celular na mesma rede, com proxy HTTPS e certificado confiável no celular. Não é suficiente aceitar um aviso de certificado inválido. Essa opção não exige publicar o servidor na internet.
- **Túnel HTTPS temporário:** por exemplo, ngrok, encaminhando o site local. Permite teste por Wi-Fi ou 4G/5G, mas torna o serviço acessível externamente e passa tráfego por um terceiro. Use somente ambiente de demonstração e contas/dados sintéticos; configure controles de acesso e desative captura de corpos sensíveis no provedor. Não exponha PostgreSQL nem segredos. Encerre o túnel ao terminar.

Apenas abrir `http://IP-DO-PC:5173` não resolve o fluxo completo: a [geolocalização exige contexto seguro](https://developer.mozilla.org/en-US/docs/Web/API/Geolocation_API), e o Ping Presença exige HTTPS/cookie seguro fora de loopback. Não remova essas proteções para testar.

## Configuração da aplicação para qualquer endereço HTTPS escolhido

Depois de configurar o proxy/túnel, suponha que seu endereço seja `https://seu-endereco-de-teste.example` (substitua pelo endereço real):

```dotenv
PUBLIC_ORIGIN=https://seu-endereco-de-teste.example
COOKIE_SECURE=true
```

1. Pare e reinicie a API com esses valores. O proxy/túnel deve encaminhar **frontend e `/api` juntos**, preservando a origem do navegador; use a porta 5173 no desenvolvimento ou 8080 no Compose, não a porta 3000 da API isolada.
2. No desenvolvimento Vite, permita **somente o hostname exato** do teste no ambiente do processo:

   ```sh
   __VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS=seu-endereco-de-teste.example npm run dev
   ```

   Não use `allowedHosts: true` ou liberação de todos os subdomínios do provedor. Veja a [documentação Vite](https://vite.dev/config/server-options#server-allowedhosts). No Compose com Nginx não há esse passo; alterações de ambiente exigem recriar o backend, conforme o README.
3. Acesse o **mesmo endereço HTTPS no computador e no celular**, faça login novamente e atualize a projeção. Uma aba ainda aberta em `localhost` será recusada porque sua origem difere da nova configuração. O QR atualizado deve conter o endereço HTTPS escolhido.
4. Use uma aula PILOT dentro do horário, matrícula anterior ao início e local cadastrado correspondente à posição física do teste. Leia o QR, confira a conta e confirme explicitamente. GPS impreciso pode gerar pendência, como definido na política.
5. Ao terminar, desligue o túnel/proxy de teste e restaure a configuração local (`PUBLIC_ORIGIN=http://localhost:5173`, `COOKIE_SECURE=false`, no desenvolvimento padrão), reiniciando a aplicação.

Se o código expirar durante o login no celular, leia o QR novamente ou digite o código atual. O endereço público não prolonga a validade do desafio.

Referência de túnel: [ngrok — compartilhar localhost](https://ngrok.com/use-cases/share-localhost). Nenhum túnel foi instalado/aberto automaticamente e nenhum teste físico de celular foi considerado concluído por esta documentação.
