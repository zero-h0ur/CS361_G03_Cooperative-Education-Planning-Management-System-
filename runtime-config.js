(function configureCoEd(root) {
  const existingConfig = root.CO_ED_CONFIG || {};

  root.CO_ED_CONFIG = Object.freeze({
    apiBaseUrl: 'https://qtqlsb1aec.execute-api.us-east-1.amazonaws.com',
    ...existingConfig
  });
})(window);
