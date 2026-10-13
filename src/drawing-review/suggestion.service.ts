/**
 * 图纸评审 - 联想服务
 * 提供项目编号、机型名称等字段的智能联想功能
 */

import type { BaseAdapter } from "./adapter";
import type { DrawingReview } from "./types";

export interface SuggestionResult {
  type: "project" | "machine" | "designer";
  value: string;
  label: string;
  count?: number;
  recent?: boolean;
}

export interface SuggestionContext {
  projectId?: string;
  machineName?: string;
  designerId?: string;
}

export class SuggestionService {
  constructor(private adapter: BaseAdapter) {}

  /**
   * 获取综合联想建议
   */
  async getSuggestions(context: SuggestionContext, query: string): Promise<SuggestionResult[]> {
    const suggestions: SuggestionResult[] = [];
    
    // 项目编号联想
    if (!context.projectId || query.toLowerCase().includes(context.projectId.toLowerCase())) {
      const projectSuggestions = await this.getProjectSuggestions(query);
      suggestions.push(...projectSuggestions);
    }
    
    // 机型名称联想
    if (!context.machineName || query.toLowerCase().includes(context.machineName.toLowerCase())) {
      const machineSuggestions = await this.getMachineSuggestions(query, context.projectId);
      suggestions.push(...machineSuggestions);
    }
    
    // 去重并排序
    return this.deduplicateAndRank(suggestions, query);
  }

  /**
   * 获取项目编号联想
   */
  private async getProjectSuggestions(query: string): Promise<SuggestionResult[]> {
    const suggestions = await this.adapter.getProjectSuggestions(query, 10);
    
    return suggestions.map(projectId => ({
      type: "project" as const,
      value: projectId,
      label: `项目: ${projectId}`,
      count: 1, // 可以后续添加使用频率统计
    }));
  }

  /**
   * 获取机型名称联想
   */
  private async getMachineSuggestions(query: string, projectId?: string): Promise<SuggestionResult[]> {
    const suggestions = await this.adapter.getMachineSuggestions(query, 10);
    
    return suggestions.map(machineName => ({
      type: "machine" as const,
      value: machineName,
      label: `机型: ${machineName}`,
      count: 1,
    }));
  }

  /**
   * 获取基于现有任务的智能建议
   */
  async getTaskBasedSuggestions(reviewId: string): Promise<SuggestionResult[]> {
    try {
      // 获取当前评审单信息
      const review = await this.adapter.findReviewById(reviewId);
      if (!review) return [];

      const suggestions: SuggestionResult[] = [];
      
      // 基于当前项目推荐相关机型
      if (review.projectId) {
        const relatedReviews = await this.adapter.findReviewsByPattern({
          projectId: review.projectId,
          limit: 5
        });
        
        relatedReviews.forEach(r => {
          if (r.machineName !== review.machineName) {
            suggestions.push({
              type: "machine",
              value: r.machineName,
              label: `相关机型: ${r.machineName} (${r.drawingVersion})`,
              recent: true,
            });
          }
        });
      }
      
      // 基于同一设计师推荐
      if (review.designerId) {
        const designerReviews = await this.adapter.findReviewsByPattern({
          designerId: review.designerId,
          limit: 3
        });
        
        designerReviews.forEach(r => {
          if (r.reviewId !== review.reviewId) {
            suggestions.push({
              type: "project",
              value: r.projectId,
              label: `历史项目: ${r.projectId} (${r.machineName})`,
              recent: true,
            });
          }
        });
      }
      
      return this.deduplicateAndRank(suggestions, "");
    } catch (error) {
      console.warn("[suggestion] Failed to get task-based suggestions:", error);
      return [];
    }
  }

  /**
   * 去重并排序联想结果
   */
  private deduplicateAndRank(suggestions: SuggestionResult[], query: string): SuggestionResult[] {
    // 按类型分组
    const groups = {
      project: [] as SuggestionResult[],
      machine: [] as SuggestionResult[],
      designer: [] as SuggestionResult[],
    };
    
    suggestions.forEach(s => {
      groups[s.type].push(s);
    });
    
    // 每组内去重并排序
    Object.keys(groups).forEach(key => {
      const type = key as keyof typeof groups;
      const seen = new Set();
      groups[type] = groups[type].filter(s => {
        if (seen.has(s.value)) return false;
        seen.add(s.value);
        return true;
      });
      
      // 按相关性排序（这里可以添加更复杂的排序逻辑）
      groups[type].sort((a, b) => {
        // 优先显示包含查询字符串的结果
        const aMatch = a.value.toLowerCase().includes(query.toLowerCase()) ? 1 : 0;
        const bMatch = b.value.toLowerCase().includes(query.toLowerCase()) ? 1 : 0;
        if (aMatch !== bMatch) return bMatch - aMatch;
        
        // 然后按使用频率排序（如果有的话）
        if (a.count && b.count) return b.count - a.count;
        
        // 最后按字母顺序
        return a.value.localeCompare(b.value);
      });
    });
    
    // 合并结果，限制总数
    const result = [
      ...groups.project.slice(0, 3),
      ...groups.machine.slice(0, 3),
      ...groups.designer.slice(0, 2),
    ];
    
    return result.slice(0, 8); // 最多返回 8 个结果
  }
}
