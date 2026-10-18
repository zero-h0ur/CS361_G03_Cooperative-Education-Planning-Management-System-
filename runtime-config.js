(function configureCoEd(root) {
  const existingConfig = root.CO_ED_CONFIG || {};
  const existingAuth = existingConfig.auth || {};
  const origin = root.location && root.location.origin ? root.location.origin : '';

  root.CO_ED_CONFIG = Object.freeze({
    apiBaseUrl: 'https://qtqlsb1aec.execute-api.us-east-1.amazonaws.com',
    ...existingConfig,
    auth: Object.freeze({
      userPoolId: '',
      userPoolClientId: '',
      domain: '',
      redirectSignIn: `${origin}/app.html`,
      redirectSignOut: `${origin}/index.html`,
      scopes: Object.freeze(['openid', 'email', 'coed-api/access']),
      ...existingAuth
    })
  });
})(window);
