(function configureCoEd(root) {
  const existingConfig = root.CO_ED_CONFIG || {};

  root.CO_ED_CONFIG = Object.freeze({
    apiBaseUrl: '',
    ...existingConfig
  });
})(window);
