import logging
from datetime import datetime, timezone
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from pathlib import Path

import aiohttp
import aiosmtplib
from jinja2 import Environment, FileSystemLoader
from pydantic import EmailStr

from app.core.config import get_settings

settings = get_settings()
logger = logging.getLogger(__name__)


class EmailService:
    _disposable_domains_cache: set[str] = set()
    _disposable_domains_cache_time: datetime | None = None

    def __init__(self) -> None:
        self.smtp_host = settings.MAIL_SERVER
        self.smtp_port = settings.MAIL_PORT
        self.smtp_username = settings.MAIL_USERNAME
        self.smtp_password = settings.MAIL_PASSWORD
        self.mail_from = settings.MAIL_FROM
        self.mail_from_name = settings.MAIL_FROM_NAME
        self.use_tls = settings.MAIL_STARTTLS
        self.use_ssl = settings.MAIL_SSL_TLS

        template_dir = Path(__file__).parent.parent / "templates" / "email"
        self.template_env = Environment(loader=FileSystemLoader(str(template_dir)))

    async def fetch_disposable_domains(self) -> set[str]:
        # Cached fetch with graceful degradation: returns fresh data if cache expired,
        # otherwise returns cached data. On network failure, returns stale cache rather
        # than failing, ensuring email validation continues working during outages.
        now = datetime.now(timezone.utc)
        if (
            EmailService._disposable_domains_cache
            and EmailService._disposable_domains_cache_time
            and (now - EmailService._disposable_domains_cache_time).total_seconds()
            < settings.DISPOSABLE_DOMAINS_CACHE_TTL_SECONDS
        ):
            return EmailService._disposable_domains_cache

        try:
            async with aiohttp.ClientSession() as session:
                async with session.get(
                    "https://raw.githubusercontent.com/7c/fakefilter/main/txt/data.txt",
                    timeout=aiohttp.ClientTimeout(total=10),
                ) as response:
                    if response.status == 200:
                        content = await response.text()
                        domains = set()
                        for line in content.splitlines():
                            line = line.strip()
                            if line and not line.startswith("#"):
                                domains.add(line.lower())
                        EmailService._disposable_domains_cache = domains
                        EmailService._disposable_domains_cache_time = now
                        return domains
        except Exception:
            pass

        if EmailService._disposable_domains_cache:
            return EmailService._disposable_domains_cache
        return set()

    async def is_disposable_email(self, email: str) -> bool:
        disposable_domains = await self.fetch_disposable_domains()

        try:
            domain = email.lower().split("@")[1]
            return domain in disposable_domains
        except (IndexError, AttributeError):
            return False

    async def _send_email(self, to_email: str, subject: str, html_body: str) -> bool:
        if not self.smtp_password:
            return False
        try:
            message = MIMEMultipart("alternative")
            message["Subject"] = subject
            message["From"] = f"{self.mail_from_name} <{self.mail_from}>"
            message["To"] = to_email

            html_part = MIMEText(html_body, "html")
            message.attach(html_part)

            await aiosmtplib.send(
                message,
                hostname=self.smtp_host,
                port=self.smtp_port,
                username=self.smtp_username,
                password=self.smtp_password,
                start_tls=self.use_tls,
                use_tls=self.use_ssl,
            )
            return True
        except Exception:
            return False

    async def send_verification_email(
        self, email: EmailStr, verification_token: str, user_name: str | None = None
    ) -> bool:
        verification_link = f"{settings.FRONTEND_URL}/verify-email?token={verification_token}&email={email}"

        subject = "Verify your Claudex account"
        template = self.template_env.get_template("verification.html")
        body = template.render(verification_link=verification_link, user_name=user_name)

        return await self._send_email(email, subject, body)

    async def send_password_reset_email(
        self, email: EmailStr, reset_token: str, user_name: str | None = None
    ) -> bool:
        reset_link = (
            f"{settings.FRONTEND_URL}/reset-password?token={reset_token}&email={email}"
        )

        subject = "Reset your Claudex password"
        template = self.template_env.get_template("password_reset.html")
        body = template.render(reset_link=reset_link, user_name=user_name)

        return await self._send_email(email, subject, body)


email_service = EmailService()
