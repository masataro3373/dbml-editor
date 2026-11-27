// 日本語コメント: DBML (Standard) 汎用方言プラグイン (src/dialects/standard/index.js)
// 標準DBML方言インスタンスを生成・エクスポートします。

import { BaseDialect } from '../base.js';
import { standardConfig } from './config.js';

export class StandardDialect extends BaseDialect {
  constructor() {
    super(standardConfig);
  }
}

export const standardDialect = new StandardDialect();
