#!/usr/bin/env node

/**
 * 文档完整性验证脚本
 * 验证所有文档文件是否存在且内容完整
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 文档清单
const DOCUMENTS = [
  {
    name: '用户使用手册',
    path: 'docs/用户使用手册_图纸评审联想功能.md',
    category: 'user',
    required: true
  },
  {
    name: '快速开始指南',
    path: 'docs/快速开始指南_图纸评审联想功能.md',
    category: 'user',
    required: true
  },
  {
    name: '常见问题 FAQ',
    path: 'docs/常见问题_FAQ_图纸评审联想功能.md',
    category: 'user',
    required: true
  },
  {
    name: '功能特性说明',
    path: 'docs/功能特性说明_图纸评审联想功能.md',
    category: 'user',
    required: false
  },
  {
    name: '开发者文档',
    path: 'docs/开发者文档_图纸评审联想功能.md',
    category: 'developer',
    required: true
  },
  {
    name: '架构设计文档',
    path: 'docs/架构设计_图纸评审联想功能.md',
    category: 'developer',
    required: false
  },
  {
    name: '扩展开发指南',
    path: 'docs/扩展开发指南_图纸评审联想功能.md',
    category: 'developer',
    required: false
  },
  {
    name: 'API 参考手册',
    path: 'docs/API参考手册_图纸评审联想功能.md',
    category: 'developer',
    required: false
  },
  {
    name: '部署指南',
    path: 'docs/部署指南_图纸评审联想功能.md',
    category: 'ops',
    required: true
  },
  {
    name: '故障排除指南',
    path: 'docs/故障排除指南_图纸评审联想功能.md',
    category: 'ops',
    required: true
  },
  {
    name: '监控运维手册',
    path: 'docs/监控运维手册_图纸评审联想功能.md',
    category: 'ops',
    required: false
  },
  {
    name: '安全运维手册',
    path: 'docs/安全运维手册_图纸评审联想功能.md',
    category: 'ops',
    required: false
  },
  {
    name: 'README',
    path: 'docs/README_图纸评审联想功能.md',
    category: 'index',
    required: true
  },
  {
    name: '文档目录索引',
    path: 'docs/文档目录索引.md',
    category: 'index',
    required: true
  },
  {
    name: '文档质量检查清单',
    path: 'docs/文档质量检查清单.md',
    category: 'quality',
    required: true
  },
  {
    name: '文档发布总结',
    path: 'docs/文档发布总结_图纸评审联想功能.md',
    category: 'summary',
    required: true
  }
];

// 质量检查标准
const QUALITY_CHECKS = {
  minLength: 1000, // 最小字符数
  requiredSections: ['##', '###'], // 必需的章节标记
  requiredElements: ['**', '`', '|'], // 必需的格式元素
  maxLength: 50000 // 最大字符数
};

class DocumentValidator {
  constructor() {
    this.results = [];
    this.stats = {
      total: 0,
      passed: 0,
      failed: 0,
      warnings: 0
    };
  }

  /**
   * 验证所有文档
   */
  async validateAll() {
    console.log('🔍 开始验证文档完整性...\n');

    for (const doc of DOCUMENTS) {
      await this.validateDocument(doc);
    }

    this.generateReport();
  }

  /**
   * 验证单个文档
   */
  async validateDocument(doc) {
    const result = {
      name: doc.name,
      path: doc.path,
      category: doc.category,
      required: doc.required,
      exists: false,
      valid: false,
      issues: [],
      warnings: []
    };

    try {
      // 检查文件是否存在
      if (!fs.existsSync(doc.path)) {
        result.issues.push('文件不存在');
        this.results.push(result);
        this.stats.total++;
        this.stats.failed++;
        return;
      }

      result.exists = true;

      // 读取文件内容
      const content = fs.readFileSync(doc.path, 'utf8');
      const lines = content.split('\n');

      // 基础检查
      await this.performBasicChecks(content, lines, result);

      // 内容质量检查
      await this.performQualityChecks(content, result);

      // 格式检查
      await this.performFormatChecks(content, result);

      result.valid = result.issues.length === 0;

    } catch (error) {
      result.issues.push(`读取文件失败: ${error.message}`);
    }

    this.results.push(result);
    this.stats.total++;
    
    if (result.valid) {
      this.stats.passed++;
    } else {
      this.stats.failed++;
    }

    if (result.warnings.length > 0) {
      this.stats.warnings++;
    }
  }

  /**
   * 基础检查
   */
  async performBasicChecks(content, lines, result) {
    // 检查文件长度
    if (content.length < QUALITY_CHECKS.minLength) {
      result.issues.push(`文件内容过短 (${content.length} < ${QUALITY_CHECKS.minLength} 字符)`);
    }

    if (content.length > QUALITY_CHECKS.maxLength) {
      result.warnings.push(`文件内容过长 (${content.length} > ${QUALITY_CHECKS.maxLength} 字符)`);
    }

    // 检查标题结构
    const hasMainTitle = lines.some(line => line.startsWith('# '));
    if (!hasMainTitle) {
      result.issues.push('缺少主标题 (# )');
    }

    // 检查章节结构
    const hasSections = QUALITY_CHECKS.requiredSections.some(section => 
      lines.some(line => line.startsWith(section))
    );
    if (!hasSections) {
      result.warnings.push('章节结构不完整');
    }

    // 检查格式元素
    const hasFormatElements = QUALITY_CHECKS.requiredElements.some(element => 
      content.includes(element)
    );
    if (!hasFormatElements) {
      result.warnings.push('缺少格式元素');
    }
  }

  /**
   * 内容质量检查
   */
  async performQualityChecks(content, result) {
    // 检查是否有实际内容
    const textContent = content.replace(/[#*`\-\|]/g, '').trim();
    if (textContent.length < 500) {
      result.issues.push('实际内容过少');
    }

    // 检查是否有示例
    const hasExamples = content.includes('示例') || content.includes('例子') || content.includes('```');
    if (!hasExamples) {
      result.warnings.push('缺少示例或代码块');
    }

    // 检查是否有联系信息
    const hasContact = content.includes('联系') || content.includes('支持') || content.includes('@');
    if (!hasContact) {
      result.warnings.push('缺少联系信息');
    }

    // 检查是否有版本信息
    const hasVersion = content.includes('版本') || content.includes('v1.') || content.includes('更新日期');
    if (!hasVersion) {
      result.warnings.push('缺少版本信息');
    }
  }

  /**
   * 格式检查
   */
  async performFormatChecks(content, result) {
    // 检查表格格式
    const tables = content.match(/\|.*\|/g);
    if (tables) {
      const malformedTables = tables.filter(table => 
        table.split('|').length < 3 || !table.includes('---')
      );
      if (malformedTables.length > 0) {
        result.warnings.push('存在格式不正确的表格');
      }
    }

    // 检查代码块格式
    const codeBlocks = content.match(/```[\s\S]*?```/g);
    if (codeBlocks) {
      const unclosedBlocks = codeBlocks.filter(block => 
        !block.endsWith('```')
      );
      if (unclosedBlocks.length > 0) {
        result.issues.push('存在未闭合的代码块');
      }
    }

    // 检查链接格式
    const links = content.match(/\[.*?\]\(.*?\)/g);
    if (links) {
      const malformedLinks = links.filter(link => 
        !link.includes('](') || !link.endsWith(')')
      );
      if (malformedLinks.length > 0) {
        result.warnings.push('存在格式不正确的链接');
      }
    }
  }

  /**
   * 生成验证报告
   */
  generateReport() {
    console.log('📊 文档验证报告');
    console.log('='.repeat(50));
    console.log(`总文档数: ${this.stats.total}`);
    console.log(`通过: ${this.stats.passed} ✅`);
    console.log(`失败: ${this.stats.failed} ❌`);
    console.log(`警告: ${this.stats.warnings} ⚠️`);
    console.log(`通过率: ${((this.stats.passed / this.stats.total) * 100).toFixed(1)}%`);
    console.log('');

    // 按类别统计
    const categories = {};
    this.results.forEach(result => {
      if (!categories[result.category]) {
        categories[result.category] = { total: 0, passed: 0, failed: 0 };
      }
      categories[result.category].total++;
      if (result.valid) {
        categories[result.category].passed++;
      } else {
        categories[result.category].failed++;
      }
    });

    console.log('📈 分类统计:');
    Object.entries(categories).forEach(([category, stats]) => {
      const percentage = ((stats.passed / stats.total) * 100).toFixed(1);
      console.log(`  ${category}: ${stats.passed}/${stats.total} (${percentage}%)`);
    });
    console.log('');

    // 显示失败的文档
    const failedDocs = this.results.filter(r => !r.valid);
    if (failedDocs.length > 0) {
      console.log('❌ 失败的文档:');
      failedDocs.forEach(doc => {
        console.log(`  - ${doc.name}: ${doc.issues.join(', ')}`);
      });
      console.log('');
    }

    // 显示警告的文档
    const warningDocs = this.results.filter(r => r.warnings.length > 0);
    if (warningDocs.length > 0) {
      console.log('⚠️ 有警告的文档:');
      warningDocs.forEach(doc => {
        console.log(`  - ${doc.name}: ${doc.warnings.join(', ')}`);
      });
      console.log('');
    }

    // 总体评价
    console.log('🎯 总体评价:');
    if (this.stats.failed === 0) {
      console.log('  🎉 所有文档都通过了验证！');
    } else if (this.stats.failed <= 2) {
      console.log('  ✅ 文档质量良好，有少量问题需要修复');
    } else {
      console.log('  ⚠️ 文档质量需要改进，存在多个问题');
    }

    // 建议
    console.log('\n💡 改进建议:');
    if (this.stats.failed > 0) {
      console.log('  - 修复失败的文档中的问题');
    }
    if (this.stats.warnings > 0) {
      console.log('  - 优化有警告的文档');
    }
    console.log('  - 定期更新文档内容');
    console.log('  - 建立文档版本控制机制');
    console.log('  - 收集用户反馈并持续改进');
  }
}

// 运行验证
async function main() {
  const validator = new DocumentValidator();
  await validator.validateAll();
}

// 如果直接运行此脚本
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}

export { DocumentValidator };
