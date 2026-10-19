// sanitize-html's parser (htmlparser2 and the dom* packages under it) ships
// as ES modules only. Node loads them with require() as it is; Jest's module
// system doesn't, so for the tests - and only there - those packages are
// turned into CommonJS. Shared by jest.config.js and tests-e2e.
const ESM_ONLY = ['htmlparser2', 'domhandler', 'domutils', 'dom-serializer', 'entities', 'domelementtype'];
const packages = ESM_ONLY.join('|');

module.exports = {
  transform: {
    [String.raw`[/\\]node_modules[/\\](${packages})[/\\].+\.js$`]:
      ['babel-jest', { babelrc: false, configFile: false, plugins: ['@babel/plugin-transform-export-namespace-from', '@babel/plugin-transform-modules-commonjs'] }],
    [String.raw`\.[jt]sx?$`]: 'babel-jest'
  },
  transformIgnorePatterns: [String.raw`[/\\]node_modules[/\\](?!(${packages})[/\\])`]
};
