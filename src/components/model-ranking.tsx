import { UsageRankingCard } from '@/components/usage-ranking'
import type { ModelRankingRange, ModelRanking, Sample } from '../../shared/domain'

const ranges: { value: ModelRankingRange; label: string }[] = [
  { value: 'today', label: '今天' }, { value: '7d', label: '近7天' }, { value: '30d', label: '近30天' },
]

export function ModelRankingCard(props: {
  description: string; sample?: Sample<ModelRanking>; error?: string; loading: boolean; currency: string;
  range: ModelRankingRange; onRangeChange: (value: ModelRankingRange) => void; onRefresh: () => void;
}) {
  const sample = props.sample && { ...props.sample, data: props.sample.data && { ...props.sample.data,
    rows: props.sample.data.rows.map(row => ({ ...row, id: row.model, name: row.model })) } }
  return <UsageRankingCard {...props} title="模型榜" sample={sample} dimension="模型" ranges={ranges} />
}
