import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CustomerForm from '../CustomerForm';

describe('CustomerForm', () => {
  it('debe renderizar los campos de nombre y teléfono', () => {
    render(
      <CustomerForm
        name=""
        phone=""
        onName={() => {}}
        onPhone={() => {}}
      />
    );

    expect(screen.getByPlaceholderText(/nombre/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/teléfono/i)).toBeInTheDocument();
  });

  it('debe mostrar los valores iniciales', () => {
    render(
      <CustomerForm
        name="Juan Pérez"
        phone="+5491112345678"
        onName={() => {}}
        onPhone={() => {}}
      />
    );

    expect(screen.getByDisplayValue('Juan Pérez')).toBeInTheDocument();
    expect(screen.getByDisplayValue('+5491112345678')).toBeInTheDocument();
  });

  it('debe llamar a onName cuando se cambia el nombre', async () => {
    const user = userEvent.setup();
    const onNameMock = vi.fn();

    render(
      <CustomerForm
        name=""
        phone=""
        onName={onNameMock}
        onPhone={() => {}}
      />
    );

    const nameInput = screen.getByPlaceholderText(/nombre/i);
    await user.type(nameInput, 'María García');

    expect(onNameMock).toHaveBeenCalled();
  });

  it('debe llamar a onPhone cuando se cambia el teléfono', async () => {
    const user = userEvent.setup();
    const onPhoneMock = vi.fn();

    render(
      <CustomerForm
        name=""
        phone=""
        onName={() => {}}
        onPhone={onPhoneMock}
      />
    );

    const phoneInput = screen.getByPlaceholderText(/teléfono/i);
    await user.type(phoneInput, '+5491112345678');

    expect(onPhoneMock).toHaveBeenCalled();
  });
});

