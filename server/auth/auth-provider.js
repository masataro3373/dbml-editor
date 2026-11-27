// 日本語コメント: 認証プロバイダー基底インターフェース (server/auth/auth-provider.js)
// ユーザー/パスワード認証 (Local) や 将来の OAuth2/OIDC 認証を共通の形式で扱うための基底クラスです。

export class BaseAuthProvider {
  /**
   * プロバイダー種別 ('local' | 'oauth')
   */
  get type() {
    throw new Error('type getter must be implemented');
  }

  /**
   * ユーザー認証処理
   * @param {Object} credentials - 認証情報 (username/password または oauthトークン)
   * @returns {Promise<Object|null>} 認証成功時はユーザー情報オブジェクト、失敗時は null
   */
  async authenticate(credentials) {
    throw new Error('authenticate() must be implemented');
  }

  /**
   * ユーザーIDによるユーザー情報取得
   * @param {string} userId - ユーザーID
   * @returns {Promise<Object|null>}
   */
  async getUserById(userId) {
    throw new Error('getUserById() must be implemented');
  }
}
