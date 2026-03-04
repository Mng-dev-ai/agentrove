export interface EnterpriseModeResponse {
  enabled: boolean;
}

export interface EnterpriseModeRequest {
  enabled: boolean;
}

export interface SmtpStatusResponse {
  enabled: boolean;
  host: string | null;
  port: number | null;
  username: string | null;
  has_password: boolean;
  from_email: string | null;
  from_name: string | null;
  use_tls: boolean;
  use_ssl: boolean;
}

export interface SmtpConfigRequest {
  host: string;
  port: number;
  username?: string | null;
  password?: string | null;
  from_email: string;
  from_name?: string | null;
  use_tls: boolean;
  use_ssl: boolean;
  enabled: boolean;
}
