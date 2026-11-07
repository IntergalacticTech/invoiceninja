<?php

namespace App\Http\Controllers\Victory;

use App\Factory\ExpenseFactory;
use App\Http\Controllers\Controller;
use App\Models\Expense;
use App\Models\ExpenseCategory;
use App\Models\Project;
use App\Repositories\ExpenseRepository;
use App\Utils\Traits\MakesHash;
use Illuminate\Http\Request;

/** The team sees only its own submitted expenses; native billing fields stay private. */
class TeamExpenseController extends Controller
{
    use MakesHash;

    private function present(Expense $expense): array
    {
        return ['id' => $expense->hashed_id, 'date' => $expense->date, 'amount' => (string) $expense->amount,
            'currency_id' => (string) $expense->currency_id, 'notes' => $expense->public_notes,
            'project_id' => $expense->project_id ? $this->encodePrimaryKey($expense->project_id) : '',
            'category_id' => $expense->category_id ? $this->encodePrimaryKey($expense->category_id) : '',
            'invoiced' => (bool) $expense->invoice_id];
    }

    public function index(Request $request): \Illuminate\Http\JsonResponse
    {
        $user = auth()->user();
        $page = $request->validate(['page' => ['sometimes', 'integer', 'min:1']]);
        $expenses = Expense::where('company_id', $user->companyId())->where('user_id', $user->id)->where('is_deleted', false)
            ->orderByDesc('date')->orderByDesc('id')->paginate(50, ['*'], 'page', $page['page'] ?? 1);
        return response()->json(['data' => collect($expenses->items())->map(fn ($row) => $this->present($row)),
            'meta' => ['pagination' => ['total' => $expenses->total(), 'current_page' => $expenses->currentPage(), 'total_pages' => $expenses->lastPage()]],
            'categories' => ExpenseCategory::where('company_id', $user->companyId())->where('is_deleted', false)->get()->map(fn ($c) => ['id' => $c->hashed_id, 'name' => $c->name]),
            'currency_id' => (string) $user->company()->settings->currency_id, 'currency_code' => \App\Models\Currency::find($user->company()->settings->currency_id)?->code ?? 'USD']);
    }

    public function store(Request $request): \Illuminate\Http\JsonResponse
    {
        $user = auth()->user();
        abort_unless($user->can('create', Expense::class), 403);
        $data = $request->validate(['request_id' => ['required', 'uuid'], 'project_id' => ['required', 'string'],
            'date' => ['required', 'date_format:Y-m-d'], 'amount' => ['required', 'numeric', 'gt:0', 'max:10000000', 'decimal:0,2'],
            'notes' => ['required', 'string', 'max:2000'], 'category_id' => ['sometimes', 'nullable', 'string']]);
        $project = Project::where('company_id', $user->companyId())->where('is_deleted', false)->findOrFail($this->decodePrimaryKey($data['project_id']));
        if (!$user->isSuperUser()) abort_unless(app(\App\Services\Victory\ProjectAccess::class)->canWrite($project->id), 403);
        $category = !empty($data['category_id']) ? ExpenseCategory::where('company_id', $user->companyId())->where('is_deleted', false)->findOrFail($this->decodePrimaryKey($data['category_id'])) : null;
        $result = \App\Services\Victory\WorkspaceCommands::run($data['request_id'], 'submit_expense', $data, function () use ($data, $project, $category, $user) {
            $expense = app(ExpenseRepository::class)->save(['date' => $data['date'], 'amount' => $data['amount'],
                'public_notes' => $data['notes'], 'project_id' => $project->id, 'client_id' => $project->client_id,
                'category_id' => $category?->id, 'currency_id' => $user->company()->settings->currency_id,
                'should_be_invoiced' => false], ExpenseFactory::create($user->companyId(), $user->id));
            return $this->present($expense);
        });
        return response()->json(['data' => $result], 201);
    }
}
