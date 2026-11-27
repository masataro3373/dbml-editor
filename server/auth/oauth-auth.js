// 日本語コメント: OAuth2/OIDC 認証プロバイダースケルトン (server/auth/oauth-auth.js)
// セキュリティ要件のある環境向けに、Google, GitHub, Azure AD, Keycloak 等の
// OAuth2 / OpenID Connect プロバイダーと連携するための拡張ポイントです。

import { BaseAuthProvider } from './auth-provider.js';

export class OAuthAuthProvider extends BaseAuthProvider {
  constructor(config = {}) {
    super();
    this.config = config;
    this.clientId = config.clientId || process.env.OAUTH_CLIENT_ID;
    this.clientSecret = config.clientSecret || process.env.OAUTH_CLIENT_SECRET;
    this.authorizationUrl = config.authorizationUrl || process.env.OAUTH_AUTH_URL;
    this.tokenUrl = config.tokenUrl || process.env.OAUTH_TOKEN_URL;
  }

  get type() {
    return 'oauth';
  }

  /**
   * OAuth 認証エンドポイントURLを生成
   */
  getLoginRedirectUrl(state) {
    if (!this.authorizationUrl) {
      throw new Error('OAuth authorizationUrl is not configured');
    }
    const params = new URLSearchParams({
      client_id: this.clientId || '',
      response_type: 'code',
      scope: 'openid profile email',
      state: state || '',
    });
    return `${this.authorizationUrl}?${params.toString()}`;
  }

  /**
   * コールバックコードからの認証
   */
  async authenticate({ code }) {
    // 将来のOAuth2トークン交換・ユーザー情報取得処理の実装プレースホルダー
    throw new Error('OAuth authentication flow is not configured in current environment');
  }

  async getUserById(userId) {
    return null;
  }
}
