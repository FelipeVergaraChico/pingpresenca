import nodemailer from 'nodemailer';
import type { Config } from '../config.js';
import { AppError } from '../platform/errors.js';

export type InvitationMail = { to: string; url: string; installationName: string };
export type MailSender = (message: InvitationMail) => Promise<void>;

export function smtpOptions(smtp: NonNullable<Config['smtp']>) {
  return { host: smtp.host, port: smtp.port, secure: smtp.secure, requireTLS: !smtp.secure,
    auth: smtp.user ? { user: smtp.user, pass: smtp.password } : undefined,
    tls: { minVersion: 'TLSv1.2' as const, rejectUnauthorized: true },
    connectionTimeout: 5000, greetingTimeout: 5000, socketTimeout: 5000, dnsTimeout: 5000,
    logger: false as const, debug: false, disableFileAccess: true, disableUrlAccess: true };
}

export function createMailSender(config: Config): MailSender {
  return async message => {
    if (!config.smtp) throw new AppError(409, 'SMTP_UNAVAILABLE', 'Envio por e-mail não configurado. Gere um convite manual.');
    const transport = nodemailer.createTransport(smtpOptions(config.smtp));
    try {
      // Nodemailer >=10.5 aborts the SMTP connection on the overall deadline.
      const mail = { from: config.smtp.from, to: message.to, signal: AbortSignal.timeout(10000),
        subject: 'Seu convite para o Ping Presença',
        text: `Você recebeu um convite para ${message.installationName}.\n\nDefina sua senha pelo link abaixo. Ele é individual, válido por 48 horas e de uso único. Não compartilhe este link.\n\n${message.url}\n\nAceitar o convite verifica o endereço que recebeu esta mensagem. Se não reconhecer o convite, não prossiga.`,
      };
      const result = await transport.sendMail(mail);
      if (!result.accepted.some(address => String(address).toLowerCase() === message.to.toLowerCase())) throw new Error('recipient rejected');
    } catch {
      // Do not propagate SMTP response text, recipients, credentials or token-bearing mail.
      throw new AppError(502, 'SMTP_SEND_FAILED', 'Não foi possível confirmar o envio. O novo convite não está ativo. Tente enviar novamente ou gere um link manual.');
    } finally { transport.close(); }
  };
}
