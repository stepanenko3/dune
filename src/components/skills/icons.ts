/** значки шкіл умінь (планувальник і картки білдів у бібліотеці) — окремо, щоб картки не тягнули сторінку планувальника */
import { Brain, Crosshair, Eye, Globe2, Swords } from 'lucide-react'

export const SCHOOL_ICON: Record<string, typeof Swords> = { trooper: Crosshair, mentat: Brain, planetologist: Globe2, benegesserit: Eye, swordmaster: Swords }
