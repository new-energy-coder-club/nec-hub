<script setup lang="ts">
// 报销明细：行选中 / 增删行 / 费用项目选择弹窗入口 / 行内即时校验（ng 红框）
import { ref } from 'vue'
import { store, lineTotal, fmtMoneyErp, validAmount, dateInSeason, addLine, delLines, selectLine, openCatModal } from '../store'

const checks = ref<Set<number>>(new Set())

function toggleCheck(i: number) {
  if (checks.value.has(i)) checks.value.delete(i)
  else checks.value.add(i)
}

function onDel() {
  delLines([...checks.value])
  checks.value = new Set()
}
</script>

<template>
  <details class="erp-section" open>
    <summary>报销明细</summary>
    <div class="body !pt-2">
      <div class="flex items-center gap-4 py-2">
        <button id="btn-add-line" class="link-btn" @click="addLine">＋ 增行</button>
        <button id="btn-del-line" class="link-btn danger" @click="onDel">－ 删行</button>
        <span class="text-xs text-nec-gray ml-auto hidden sm:inline">点击行选中；费用项目/附件 OCR 均作用于选中行</span>
      </div>
      <div class="overflow-x-auto">
        <table class="line-table">
          <thead>
            <tr>
              <th class="w-8"></th>
              <th class="w-8">#</th>
              <th class="req" style="min-width:170px">费用项目</th>
              <th class="req" style="min-width:180px">事项说明</th>
              <th style="min-width:130px">开票日期</th>
              <th style="min-width:130px">发票号</th>
              <th class="req" style="min-width:110px">金额（元）</th>
              <th style="min-width:120px">备注</th>
            </tr>
          </thead>
          <tbody id="line-body">
            <tr v-for="(l, i) in store.lines" :key="i" :class="{ selected: i === store.selected }" @click="selectLine(i)">
              <td><input type="checkbox" class="line-check" :checked="checks.has(i)" @click.stop="toggleCheck(i)" /></td>
              <td class="mono text-nec-gray">{{ i + 1 }}</td>
              <td>
                <button type="button" class="line-input text-left cat-pick" :class="{ ng: !l.cat }"
                        style="border:1px solid var(--nec-line);background:#fff;display:flex;justify-content:space-between;align-items:center;gap:4px"
                        @click="openCatModal(i)">
                  <span :class="l.cat ? '' : 'text-nec-gray'">{{ l.cat || '请选择' }}</span><span class="text-nec-gray">🔍</span>
                </button>
              </td>
              <td><input class="line-input" :class="{ ng: !l.item }" v-model="l.item" placeholder="如：铝型材打样运费" /></td>
              <td><input type="date" class="line-input" :class="{ ng: l.date && !dateInSeason(l.date) }" v-model="l.date" /></td>
              <td><input class="line-input mono" :class="{ ng: l.invno && !/^\d{8}$|^\d{20}$/.test(l.invno) }" v-model="l.invno" placeholder="8 或 20 位" /></td>
              <td><input inputmode="decimal" class="line-input mono text-right" :class="{ ng: !validAmount(l.amount) }" v-model="l.amount" placeholder="0.00" /></td>
              <td><input class="line-input" v-model="l.note" /></td>
            </tr>
          </tbody>
          <tfoot>
            <tr>
              <td colspan="6" class="text-right text-xs text-nec-gray font-semibold">合计</td>
              <td id="line-total" class="mono font-black text-nec-navy">{{ fmtMoneyErp(lineTotal) }}</td>
              <td></td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  </details>
</template>
