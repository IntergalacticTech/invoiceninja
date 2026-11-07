<?php

namespace App\Http\Controllers\Victory;

use App\Factory\InvoiceFactory;
use App\Http\Controllers\Controller;
use App\Models\Expense;
use App\Models\Invoice;
use App\Models\Project;
use App\Models\Task;
use App\Repositories\InvoiceRepository;
use App\Repositories\ProjectRepository;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/** Native project invoice composition/calculation, with an explicit reviewed-draft step. */
class ProjectInvoiceController extends Controller
{
    private function authorizeProject(Project $project): void
    {
        abort_unless(auth()->user()->isSuperUser() && (int) $project->company_id === auth()->user()->companyId(), 403);
        abort_unless(!$project->is_deleted && $project->client && !$project->client->is_deleted, 422, 'An active project client is required.');
    }

    private function draft(Project $project): Invoice
    {
        $draft = app(ProjectRepository::class)->invoice(collect([$project]));
        $draft->uses_inclusive_taxes = (bool) $project->client->getSetting('inclusive_taxes');
        // getInvoice() persists; getTempEntity() is the native non-persisting calculator.
        return $draft->calc()->getTempEntity();
    }

    private function fingerprint(Invoice $draft): string
    {
        return hash('sha256', json_encode(['lines' => $draft->line_items, 'amount' => $draft->amount,
            'taxes' => $draft->total_taxes, 'client_id' => $draft->client_id, 'inclusive' => $draft->uses_inclusive_taxes,
            'currency' => $draft->client->getSetting('currency_id')], JSON_THROW_ON_ERROR));
    }

    private function present(Invoice $draft): array
    {
        return ['project' => $draft->project?->name, 'client' => $draft->client->name,
            'currency' => $draft->client->currency()->code, 'amount' => (string) $draft->amount, 'taxes' => (string) $draft->total_taxes,
            'lines' => collect($draft->line_items)->map(fn ($line) => [
                'description' => trim(html_entity_decode(strip_tags($line->notes ?? ''))), 'quantity' => (float) $line->quantity,
                'rate' => (float) $line->cost, 'total' => (float) $line->line_total, 'kind' => !empty($line->task_id) ? 'Time' : 'Expense',
            ])->values()];
    }

    public function preview(Project $project): \Illuminate\Http\JsonResponse
    {
        $this->authorizeProject($project);
        $draft = $this->draft($project);
        $user = auth()->user();
        $id = (string) Str::uuid();
        DB::table('victory_invoice_previews')->where('company_id', $user->companyId())->where('user_id', $user->id)->whereNull('invoice_id')->where('expires_at', '<', now())->delete();
        DB::table('victory_invoice_previews')->insert(['id' => $id, 'company_id' => $user->companyId(), 'user_id' => $user->id,
            'project_id' => $project->id, 'fingerprint' => $this->fingerprint($draft),
            'task_ids' => json_encode(collect($draft->line_items)->pluck('task_id')->filter()->values()),
            'expires_at' => now()->addMinutes(15), 'created_at' => now(), 'updated_at' => now()]);
        return response()->json(['data' => $this->present($draft) + ['preview_id' => $id, 'expires_in' => 900]]);
    }

    public function create(Request $request, Project $project): \Illuminate\Http\JsonResponse
    {
        $this->authorizeProject($project);
        $data = $request->validate(['preview_id' => ['required', 'uuid']]);
        $user = auth()->user();
        $result = DB::transaction(function () use ($data, $project, $user) {
            $preview = DB::table('victory_invoice_previews')->where('id', $data['preview_id'])->where('company_id', $user->companyId())
                ->where('user_id', $user->id)->where('project_id', $project->id)->lockForUpdate()->first();
            abort_unless($preview, 404);
            if ($preview->invoice_id) {
                $existing = Invoice::where('company_id', $user->companyId())->findOrFail($preview->invoice_id);
                return ['id' => $existing->hashed_id, 'number' => $existing->number, 'status' => 'draft'];
            }
            abort_if(\Carbon\Carbon::parse($preview->expires_at)->isPast(), 409, 'This preview expired. Generate a fresh preview.');
            $project = Project::where('company_id', $user->companyId())->lockForUpdate()->findOrFail($project->id);
            Task::withTrashed()->where('company_id', $user->companyId())->where('project_id', $project->id)->orderBy('id')->lockForUpdate()->get(['id']);
            Expense::withTrashed()->where('company_id', $user->companyId())->where('project_id', $project->id)->orderBy('id')->lockForUpdate()->get(['id']);
            $draft = $this->draft($project);
            abort_unless(hash_equals($preview->fingerprint, $this->fingerprint($draft)), 409, 'The project changed. Review a fresh preview before creating the invoice.');
            abort_if(count($draft->line_items) === 0, 422, 'There is no uninvoiced billable work.');
            $invoice = app(InvoiceRepository::class)->save(['client_id' => $project->client_id, 'project_id' => $project->id,
                'line_items' => json_decode(json_encode($draft->line_items), true), 'status_id' => Invoice::STATUS_DRAFT,
                'date' => now($user->company()->timezone()->name)->toDateString(), 'auto_bill_enabled' => false], InvoiceFactory::create($user->companyId(), $user->id));
            $invoice->auto_bill_enabled = false;
            $invoice->service()->linkEntities()->save();
            DB::table('victory_invoice_previews')->where('id', $preview->id)->update(['invoice_id' => $invoice->id, 'updated_at' => now()]);
            return ['id' => $invoice->hashed_id, 'number' => $invoice->number, 'status' => 'draft'];
        }, 3);
        return response()->json(['data' => $result], 201);
    }
}
