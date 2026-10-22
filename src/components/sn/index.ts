/**
 * Компоненти @snotax/ui, якими користується сайт (реєструємо лише їх — решта не йде в збірку).
 * Важкі, потрібні лише панелі керування (таблиця, бічне меню, календар, комбобокс…), реєструє ./admin.ts —
 * він у шматку панелі. Як передавати властивості й слухати події — див. ./sn.tsx.
 */
import '@snotax/ui/elements/button'
import '@snotax/ui/elements/input'
import '@snotax/ui/elements/input-otp'
import '@snotax/ui/elements/textarea'
import '@snotax/ui/elements/select'
import '@snotax/ui/elements/switch'
import '@snotax/ui/elements/toggle'
import '@snotax/ui/elements/checkbox'
import '@snotax/ui/elements/badge'
import '@snotax/ui/elements/dialog'
import '@snotax/ui/elements/alert-dialog'
import '@snotax/ui/elements/sheet'
import '@snotax/ui/elements/tabs'
import '@snotax/ui/elements/number-field'
import '@snotax/ui/elements/color-picker'
import '@snotax/ui/elements/segmented-control'
import '@snotax/ui/elements/field'
import '@snotax/ui/elements/card'
import '@snotax/ui/elements/skeleton'
import '@snotax/ui/elements/spinner'
import '@snotax/ui/elements/empty-state'
import '@snotax/ui/elements/alert'
import '@snotax/ui/elements/banner'
import '@snotax/ui/elements/menu'
import { sn } from './sn'

export { sn, valueOf, checkedOf, type SnEvent, type SnProps } from './sn'

export const SnButton = sn('sn-button')
export const SnInput = sn('sn-input')
export const SnInputOtp = sn('sn-input-otp')
export const SnTextarea = sn('sn-textarea')
export const SnSelect = sn('sn-select')
export const SnSwitch = sn('sn-switch')
export const SnToggle = sn('sn-toggle')
export const SnCheckbox = sn('sn-checkbox')
export const SnBadge = sn('sn-badge')
export const SnDialog = sn('sn-dialog')
export const SnAlertDialog = sn('sn-alert-dialog')
export const SnSheet = sn('sn-sheet')
export const SnDataTable = sn('sn-datatable')
export const SnTabs = sn('sn-tabs')
export const SnTabsList = sn('sn-tabs-list')
export const SnTabsTrigger = sn('sn-tabs-trigger')
export const SnTabsContent = sn('sn-tabs-content')
export const SnDatePicker = sn('sn-date-picker')
export const SnNumberField = sn('sn-number-field')
export const SnColorPicker = sn('sn-color-picker')
export const SnSegmented = sn('sn-segmented-control')
export const SnSegmentedItem = sn('sn-segmented-control-item')
export const SnField = sn('sn-field')
export const SnFieldLabel = sn('sn-field-label')
export const SnFieldDescription = sn('sn-field-description')
export const SnCard = sn('sn-card')
export const SnCardHeader = sn('sn-card-header')
export const SnCardTitle = sn('sn-card-title')
export const SnCardDescription = sn('sn-card-description')
export const SnCardAction = sn('sn-card-action')
export const SnCardContent = sn('sn-card-content')
export const SnCardFooter = sn('sn-card-footer')
export const SnEmptyState = sn('sn-empty-state')
export const SnSkeleton = sn('sn-skeleton')
export const SnSpinner = sn('sn-spinner')
export const SnAlert = sn('sn-alert')
export const SnAlertTitle = sn('sn-alert-title')
export const SnAlertDescription = sn('sn-alert-description')
export const SnBanner = sn('sn-banner')
export const SnBreadcrumb = sn('sn-breadcrumb')
export const SnBreadcrumbList = sn('sn-breadcrumb-list')
export const SnBreadcrumbItem = sn('sn-breadcrumb-item')
export const SnBreadcrumbLink = sn('sn-breadcrumb-link')
export const SnBreadcrumbPage = sn('sn-breadcrumb-page')
export const SnBreadcrumbSeparator = sn('sn-breadcrumb-separator')
export const SnProgress = sn('sn-progress')
export const SnDialogContent = sn('sn-dialog-content')
export const SnDialogHeader = sn('sn-dialog-header')
export const SnDialogTitle = sn('sn-dialog-title')
export const SnDialogDescription = sn('sn-dialog-description')
export const SnDialogFooter = sn('sn-dialog-footer')
export const SnEmptyStateHeader = sn('sn-empty-state-header')
export const SnEmptyStateMedia = sn('sn-empty-state-media')
export const SnEmptyStateTitle = sn('sn-empty-state-title')
export const SnEmptyStateDescription = sn('sn-empty-state-description')
export const SnEmptyStateContent = sn('sn-empty-state-content')
export const SnAlertAction = sn('sn-alert-action')
export const SnDropdownMenu = sn('sn-dropdown-menu')
export const SnDropdownMenuTrigger = sn('sn-dropdown-menu-trigger')
export const SnDropdownMenuContent = sn('sn-dropdown-menu-content')
export const SnDropdownMenuItem = sn('sn-dropdown-menu-item')
export const SnDropdownMenuLabel = sn('sn-dropdown-menu-label')
export const SnDropdownMenuSeparator = sn('sn-dropdown-menu-separator')
export const SnDropdownMenuRadioGroup = sn('sn-dropdown-menu-radio-group')
export const SnDropdownMenuRadioItem = sn('sn-dropdown-menu-radio-item')
