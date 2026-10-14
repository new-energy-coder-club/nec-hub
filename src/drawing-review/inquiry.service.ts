/**
 * 新增机图纸评审流程 — 三家询价单流转与比价服务（PRD §3.11）
 *
 * 流转：BOM 外购/标准件 → generate 生成询价单(sent) → quote 供应商回填(quoted)
 *       → compare 输出比价建议书，并按 selections 置 selected/rejected。
 */

import type { DrawingReviewAdapter } from "./adapter";
import { notifyFeishuGroup } from "./notify";
import type { BOMSource, Inquiry } from "./types";

/** 比价规则：价格优先；交期晚于需求日期的报价按惩罚系数折算后再比较 */
export const COMPARE_RULES = {
  lateDeliveryPenalty: 1.2,
} as const;

const QUOTABLE_SOURCES: BOMSource[] = ["purchased", "standard"];

function localToday(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

export interface GenerateInquiriesInput {
  /** 需求日期，缺省默认当天（YYYY-MM-DD，本地时区） */
  requiredDate?: string;
  /** 物料编码 → 推荐供应商列表；未提供的物料生成一条供应商待定的询价单 */
  suppliers?: Record<string, string[]>;
}

export interface QuoteInput {
  supplier: string;
  price: number;
  deliveryDate?: string;
}

export interface QuoteComparison {
  inquiryId: string;
  supplierName: string;
  price?: number;
  deliveryDate?: string;
  status: Inquiry["status"];
  late: boolean;
  score?: number;
}

export interface MaterialComparison {
  bomItemId: string;
  materialCode?: string;
  materialName?: string;
  requiredDate?: string;
  quotes: QuoteComparison[];
  lowestPriceInquiryId?: string;
  shortestDeliveryInquiryId?: string;
  recommendedInquiryId?: string;
  reason?: string;
}

export interface CompareResult {
  reviewId: string;
  materials: MaterialComparison[];
  selected: string[];
  generatedAt: string;
}

function generateInquiryId(existing: Set<string>): string {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  for (let i = 0; i < 10; i++) {
    const id = `INQ-${date}-${Math.floor(100 + Math.random() * 900)}`;
    if (!existing.has(id)) return id;
  }
  return `INQ-${date}-${Date.now() % 100000}`;
}

export class InquiryService {
  constructor(
    private env: Env,
    private adapter: DrawingReviewAdapter,
  ) {}

  /** 从评审单 BOM 筛外购/标准件物料生成询价单；已生成过的物料跳过（幂等） */
  async generate(
    reviewId: string,
    input: GenerateInquiriesInput,
    actorId: string,
  ): Promise<{ created: Array<Inquiry & { recordId: string }>; skipped: string[] }> {
    const data = await this.adapter.getBOMByReview(reviewId);
    if (!data) throw new Error(`评审单 ${reviewId} 尚无 BOM，请先生成 BOM`);

    const items = data.items.filter((it) => QUOTABLE_SOURCES.includes(it.source));
    const requiredDate = input.requiredDate ?? localToday();
    const existing = await this.adapter.listInquiries(reviewId);
    const existingItems = new Set(existing.map((i) => i.bomItemId));
    const existingIds = new Set(existing.map((i) => i.inquiryId));

    const created: Array<Inquiry & { recordId: string }> = [];
    const skipped: string[] = [];
    // 先顺序生成全部询价单号（保证唯一性与跳过语义），再并行写入 Base
    const toCreate: Inquiry[] = [];
    for (const item of items) {
      const key = item.itemId;
      if (existingItems.has(key)) {
        skipped.push(item.materialCode ?? item.materialName);
        continue;
      }
      const supplierList =
        (item.materialCode && input.suppliers?.[item.materialCode]) ||
        (input.suppliers?.[item.itemId] ?? []) ||
        [];
      const suppliers = supplierList.length > 0 ? supplierList : ["待定"];
      for (const supplier of suppliers) {
        const inquiryId = generateInquiryId(existingIds);
        existingIds.add(inquiryId);
        toCreate.push({
          inquiryId,
          reviewId,
          bomItemId: item.itemId,
          materialCode: item.materialCode,
          materialName: item.materialName,
          specification: item.specification,
          supplierName: supplier,
          quantity: item.quantity,
          requiredDate,
          status: "sent",
          createdAt: new Date().toISOString(),
        });
        existingItems.add(key);
      }
    }
    created.push(...(await Promise.all(toCreate.map((inquiry) => this.adapter.createInquiry(inquiry)))));

    await this.logEvent(reviewId, actorId, "inquiry_generate", {
      created: created.map((c) => c.inquiryId),
      skipped,
    });
    return { created, skipped };
  }

  /** 供应商报价回填：sent → quoted */
  async quote(inquiryId: string, input: QuoteInput, actorId: string): Promise<Inquiry & { recordId: string }> {
    if (!input.supplier?.trim()) throw new Error("供应商名称必填");
    if (typeof input.price !== "number" || !Number.isFinite(input.price) || input.price <= 0) {
      throw new Error("报价必须为大于 0 的数字");
    }
    const inquiry = await this.adapter.findInquiryById(inquiryId);
    if (!inquiry) throw new Error(`询价单 ${inquiryId} 不存在`);
    if (inquiry.status !== "sent") throw new Error(`询价单当前状态为 ${inquiry.status}，不允许报价回填`);

    const updated = await this.adapter.updateInquiry(inquiry.recordId, {
      supplierName: input.supplier.trim(),
      price: input.price,
      deliveryDate: input.deliveryDate,
      status: "quoted",
    });
    await this.logEvent(inquiry.reviewId, actorId, "inquiry_quote", {
      inquiryId,
      supplier: updated.supplierName,
      price: updated.price,
      deliveryDate: updated.deliveryDate,
    });
    await notifyFeishuGroup(
      this.env,
      `💰 询价单报价回填\n询价单 ${inquiryId}（${updated.materialName ?? updated.bomItemId}）\n供应商：${updated.supplierName}，报价：${updated.price}${updated.deliveryDate ? `，交期：${updated.deliveryDate}` : ""}`,
    );
    return updated;
  }

  /**
   * 按物料分组比价并输出建议书；selections（物料编码/物料项ID → inquiryId）执行选定，
   * 被选中的置 selected，同物料其余报价置 rejected。
   */
  async compare(
    reviewId: string,
    selections: Record<string, string> | undefined,
    actorId: string,
  ): Promise<CompareResult> {
    const inquiries = await this.adapter.listInquiries(reviewId);
    const groups = new Map<string, Array<Inquiry & { recordId: string }>>();
    for (const inq of inquiries) {
      const list = groups.get(inq.bomItemId) ?? [];
      list.push(inq);
      groups.set(inq.bomItemId, list);
    }

    const materials: MaterialComparison[] = [];
    for (const [bomItemId, list] of groups) {
      const quoted = list.filter((i) => i.price != null);
      const requiredDate = list.find((i) => i.requiredDate)?.requiredDate;
      const requiredTs = requiredDate ? Date.parse(requiredDate) : NaN;

      const quotes: QuoteComparison[] = list.map((i) => {
        const deliveryTs = i.deliveryDate ? Date.parse(i.deliveryDate) : NaN;
        const late = !Number.isNaN(requiredTs) && !Number.isNaN(deliveryTs) && deliveryTs > requiredTs;
        const hasPrice = i.price != null;
        return {
          inquiryId: i.inquiryId,
          supplierName: i.supplierName,
          price: i.price,
          deliveryDate: i.deliveryDate,
          status: i.status,
          late,
          score: hasPrice ? i.price! * (late ? COMPARE_RULES.lateDeliveryPenalty : 1) : undefined,
        };
      });

      const mc: MaterialComparison = {
        bomItemId,
        materialCode: list[0]?.materialCode,
        materialName: list[0]?.materialName,
        requiredDate,
        quotes,
      };

      if (quoted.length > 0) {
        const byPrice = [...quoted].sort((a, b) => a.price! - b.price!);
        mc.lowestPriceInquiryId = byPrice[0].inquiryId;
        const withDelivery = quoted.filter((i) => i.deliveryDate && !Number.isNaN(Date.parse(i.deliveryDate)));
        if (withDelivery.length > 0) {
          withDelivery.sort((a, b) => Date.parse(a.deliveryDate!) - Date.parse(b.deliveryDate!));
          mc.shortestDeliveryInquiryId = withDelivery[0].inquiryId;
        }
        const best = quotes
          .filter((q) => q.score != null)
          .sort((a, b) => a.score! - b.score! || Date.parse(a.deliveryDate ?? "9999") - Date.parse(b.deliveryDate ?? "9999"))[0];
        mc.recommendedInquiryId = best.inquiryId;
        mc.reason = best.late
          ? `供应商 ${best.supplierName} 折算价 ${best.score!.toFixed(2)}（交期超需求日期，按 ${COMPARE_RULES.lateDeliveryPenalty} 倍惩罚后仍最优）`
          : `供应商 ${best.supplierName} 报价 ${best.price} 为有效最低且交期满足需求`;
      }
      materials.push(mc);
    }

    const selected: string[] = [];
    if (selections && Object.keys(selections).length > 0) {
      const byMaterialKey = new Map<string, Array<Inquiry & { recordId: string }>>();
      for (const [bomItemId, list] of groups) {
        for (const key of [bomItemId, list[0]?.materialCode].filter(Boolean) as string[]) {
          byMaterialKey.set(key, list);
        }
      }
      for (const [materialKey, inquiryId] of Object.entries(selections)) {
        const list = byMaterialKey.get(materialKey);
        if (!list) throw new Error(`物料 ${materialKey} 在评审单 ${reviewId} 下没有询价单`);
        const target = list.find((i) => i.inquiryId === inquiryId);
        if (!target) throw new Error(`询价单 ${inquiryId} 不属于物料 ${materialKey}`);
        if (target.status !== "quoted") throw new Error(`询价单 ${inquiryId} 尚未报价，无法选定`);
        await Promise.all(
          list.map((inq) => {
            if (inq.inquiryId === inquiryId && inq.status !== "selected") {
              return this.adapter.updateInquiry(inq.recordId, { status: "selected" });
            }
            if (inq.inquiryId !== inquiryId && (inq.status === "quoted" || inq.status === "selected")) {
              return this.adapter.updateInquiry(inq.recordId, { status: "rejected" });
            }
            return null;
          }),
        );
        selected.push(inquiryId);
        await this.logEvent(reviewId, actorId, "inquiry_select", {
          material: materialKey,
          selectedInquiryId: inquiryId,
          supplier: target.supplierName,
          price: target.price,
        });
      }
      await notifyFeishuGroup(
        this.env,
        `✅ 询价选定完成\n评审单 ${reviewId}\n已选定 ${selected.length} 项物料的供应商：${selected.join("、")}`,
      );
    }

    return { reviewId, materials, selected, generatedAt: new Date().toISOString() };
  }

  private async logEvent(reviewId: string, actorId: string, action: string, payload?: Record<string, unknown>): Promise<void> {
    try {
      await this.adapter.createRecord("events", {
        关联评审单: reviewId,
        操作人: actorId,
        动作: action,
        附加信息: payload ? JSON.stringify(payload) : "",
        操作时间: new Date().toISOString(),
      });
    } catch (err) {
      console.error("[drawing-review] inquiry log event failed:", err);
    }
  }
}
