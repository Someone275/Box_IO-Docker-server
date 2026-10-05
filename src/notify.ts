import nodemailer from "nodemailer";
import { getSettings } from "./db.js";

function smtpTransport() {
  const s = getSettings();
  if (!s.smtp_host) return null;
  return nodemailer.createTransport({
    host: s.smtp_host,
    port: Number(s.smtp_port || 587),
    secure: s.smtp_secure === "1" || s.smtp_secure === "true",
    connectionTimeout: 8000,
    greetingTimeout: 8000,
    socketTimeout: 15000,
    auth:
      s.smtp_user && s.smtp_pass
        ? { user: s.smtp_user, pass: s.smtp_pass }
        : undefined,
  });
}

function emailError(err: unknown): Error {
  const message = err instanceof Error ? err.message : "Could not send email";
  if (/timeout|greeting|ECONNREFUSED|ENOTFOUND|EHOSTUNREACH|ETIMEDOUT|ECONNRESET/i.test(message)) {
    return new Error("Could not reach the email server. Check the SMTP host and port in Settings.");
  }
  return err instanceof Error ? err : new Error(message);
}

export async function sendEmail(
  to: string,
  subject: string,
  body: string,
): Promise<void> {
  const s = getSettings();
  const transport = smtpTransport();
  if (!transport) {
    throw new Error("SMTP is not configured. Set it in Settings.");
  }
  const from = s.smtp_from || s.smtp_user || "boxio@localhost";
  try {
    await transport.sendMail({ from, to, subject, text: body });
  } catch (err) {
    throw emailError(err);
  }
}

export async function sendSms(to: string, body: string): Promise<void> {
  const s = getSettings();
  const sid = s.twilio_sid;
  const token = s.twilio_token;
  const from = s.twilio_from;
  if (!sid || !token || !from) {
    throw new Error("Twilio is not configured. Set it in Settings.");
  }
  const url = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`;
  const params = new URLSearchParams({ To: to, From: from, Body: body });
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: "Basic " + Buffer.from(`${sid}:${token}`).toString("base64"),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Twilio error (${res.status}): ${text.slice(0, 300)}`);
  }
}

export async function verifySmtp(): Promise<string> {
  const transport = smtpTransport();
  if (!transport) throw new Error("SMTP is not configured");
  await transport.verify();
  return "SMTP connection succeeded";
}
