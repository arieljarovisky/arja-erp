export default function CustomerForm({ name, phone, onName, onPhone }) {
    return (
        <div className="grid md:grid-cols-2 gap-3">
            <input type="text" placeholder="Nombre (opcional)" value={name} onChange={(e) => onName(e.target.value)} className="w-full rounded-xl border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-black/10" />
            <input type="tel" placeholder="Teléfono en WhatsApp (ej +54911...)" value={phone} onChange={(e) => onPhone(e.target.value)} className="w-full rounded-xl border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-black/10" />
        </div>
    );
}