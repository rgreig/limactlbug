'use strict';

import { createRequire } from 'module';
import path from 'path';
import webpack from 'webpack';
import url from 'url';

class DevRunner {

    get srcDir() {
        return path.resolve(url.fileURLToPath(import.meta.url), '..', '..');
    }

    get srcTsDir() {
        return path.resolve(this.srcDir, 'src');
    }

    /** The package.json metadata. */
    get packageMeta() {
        return this.require('package.json');
    }

    /**
   * Get the directory where all of the build artifacts should reside.
   */
    get distDir() {
        return path.resolve(this.srcDir, 'dist');
    }

    _require = createRequire(import.meta.url);

    require(pkgPath) {
        return this._require(path.resolve(this.srcDir, pkgPath));
    }

    /**
     * Get the directory holding the generated files.
     */
    get appDir() {
        return path.resolve(this.distDir, 'app');
    }

    get webpackConfig() {
        const mode = 'development';

        return {
            mode,
            target: 'electron-main',
            node: {
                __dirname: false,
                __filename: false,
            },
            entry: { spawntest: path.resolve(this.srcTsDir, 'spawntest') },
            externals: [...Object.keys(this.packageMeta.dependencies)],
            devtool: 'source-map',
            resolve: {
                alias: { '@': path.resolve(this.srcDir, 'src') },
                extensions: ['.ts', '.js', '.json'],
                modules: ['node_modules'],
            },
            output: {
                libraryTarget: 'commonjs2',
                filename: '[name].js',
                path: this.appDir,
            },
            module: {
                rules: [
                    {
                        test: /\.ts$/,
                        use: { loader: 'ts-loader' }
                    },
                    {
                        test: /\.js$/,
                        use: {
                            loader: 'babel-loader',
                            options: {
                                ...this.babelConfig,
                                cacheDirectory: true,
                            },
                        },
                        exclude: [/node_modules/, this.distDir],
                    },
                    {
                        test: /\.ya?ml$/,
                        use: { loader: 'js-yaml-loader' },
                    },
                    {
                        test: /(?:^|[/\\])assets[/\\]scripts[/\\]/,
                        use: { loader: 'raw-loader' },
                    },
                ],
            },
            plugins: [
                new webpack.EnvironmentPlugin({ NODE_ENV: process.env.NODE_ENV || 'production' }),
            ],
        };
    }

    buildJavaScript() {
        webpack(this.webpackConfig).run((err, stats) => {
            if (err) {
                throw err;
            }
            if (stats.hasErrors()) {
                throw new Error(stats.toString({ colors: true, errorDetails: true }));
            }
            console.log(stats.toString({ colors: true }));
        });
    }

    buildMain() {
        this.buildJavaScript();
    }

    async run() {
        this.buildMain();
    }
}



(new DevRunner()).run().catch((e) => {
    console.error(e);
    process.exit(1);
});
