// eslint-disable-next-line @typescript-eslint/no-var-requires
const path = require('path');
const CopyPlugin = require('copy-webpack-plugin');

module.exports = {
  entry: './ts/webworker/workers/node/image_processor/image_processor.worker.ts',
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        use: 'ts-loader',
        exclude: /node_modules/,
      },
      {
        test: /\.wasm$/,
        type: 'asset/inline',
      },
    ],
  },
  resolve: {
    extensions: ['.ts', '.js'],
    fallback: {
      crypto: false,
      path: false,
      fs: false,
      stream: false,
    },
  },
  output: {
    filename: 'image_processor.worker.compiled.js',
    path: path.resolve(__dirname, 'ts', 'webworker', 'workers', 'node', 'image_processor'),
  },
  target: 'node',

  optimization: {
    minimize: process.env.NODE_ENV === 'production',
  },
  mode: process.env.NODE_ENV === 'production' ? 'production' : 'development',
  watch: false, // false by default but can be overridden by the command line
  watchOptions: {
    aggregateTimeout: 200,
    poll: 1000,
  },
  plugins: [
    new CopyPlugin({
      patterns: [
        {
          from: 'node_modules/wasm-vips/lib/vips.wasm',
          to: 'wasm-vips/vips.wasm',
        },
        {
          from: 'node_modules/wasm-vips/lib/vips-jxl.wasm',
          to: 'wasm-vips/vips-jxl.wasm',
        },
        {
          from: 'node_modules/wasm-vips/lib/vips-heif.wasm',
          to: 'wasm-vips/vips-heif.wasm',
        },
        {
          from: 'node_modules/wasm-vips/lib/vips-resvg.wasm',
          to: 'wasm-vips/vips-resvg.wasm',
        },
      ],
    }),
  ],
};
