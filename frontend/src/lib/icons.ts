import { Calendar, CircleDashed, Hash, Tag, ToggleLeft, Type, type LucideIcon } from 'lucide-react'
import type { InferredType } from './types'

export const TYPE_ICONS: Record<InferredType, LucideIcon> = {
  number: Hash,
  date: Calendar,
  boolean: ToggleLeft,
  category: Tag,
  text: Type,
  empty: CircleDashed,
}
