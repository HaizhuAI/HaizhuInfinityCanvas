import nodemailer from 'nodemailer'

/**
 * Outgoing mail for password resets (accounts mode). Optional: without HZC_SMTP_URL the sign-in page
 * says to ask the admin, who resets passwords from the admin console or the admin command.
 *   HZC_SMTP_URL   smtps://user:password@smtp.example.com:465  (or smtp://…:587 for STARTTLS)
 *   HZC_MAIL_FROM  "Haizhu Infinity Canvas <no-reply@example.com>"
 */
export interface Mailer { send(to: string, subject: string, text: string): Promise<void> }

export function smtpMailer(url: string, from: string): Mailer {
  const transport = nodemailer.createTransport(url)
  return {
    async send(to, subject, text) {
      await transport.sendMail({ from, to, subject, text })
    },
  }
}

export function resetMail(link: string, minutes: number) {
  return {
    subject: '重置你的海柱无限画布密码',
    text: [
      '有人（希望是你）请求重置这个邮箱对应账号的密码。',
      '',
      `在 ${minutes} 分钟内打开下面的链接设置新密码，链接只能用一次：`,
      link,
      '',
      '如果不是你本人操作，忽略这封邮件即可，你的密码不会改变。',
    ].join('\n'),
  }
}
